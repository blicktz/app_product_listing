# **Product Requirements Document (PRD): Internal Photography App \- Phase 2**

## **Objective**

Design and implement the UI and workflow for Phase 2: Inventory & SKU Management. The goal is to build a functional, testable application that allows users to define a SKU, capture a series of 1:1 aspect ratio photos mimicking the eBay app experience, manage those photos during the capture session, and automatically upload them to Cloudflare R2 with structured folder paths and filenames upon completion.

## **Core Features & Workflows**

The application will consist of two primary views: the **Home View** (Session & SKU setup) and the **Camera View** (Capture & Management).

### **View 1: Home View (Session & SKU Entry)**

This is the default screen when the app opens.

**UI Elements:**

1. **Session/Root Directory Display:** A clear visual indicator of the current day's root folder where all images will be saved.  
   * **Format:** Based on current date/time stamp (e.g., YYYY-MM-DD/).  
   * **Purpose:** Confirms to the user where the day's work is being routed in R2.  
2. **SKU Input Field:** A text input field allowing the user to manually enter the SKU for the next item being photographed.  
   * *Future Enhancement Placeholder (Not strictly required for this immediate phase but keep in mind):* Auto-incrementing logic for sequential items.  
3. **"Start Capture" Button:** A prominent button that becomes active once a valid SKU is entered. Tapping this button navigates the user to the **Camera View**.

### **View 2: Camera View (Capture & Management)**

This view handles the core photo acquisition, designed to emulate the eBay mobile app's listing flow.

**UI Elements & Behavior:**

1. **Full-Screen 1:1 Camera Preview:**  
   * The camera preview must run full screen (or as close as possible while accommodating the thumbnail row).  
   * **Crucial Requirement:** The capture aspect ratio *must* be natively set to 1:1 (square). Ensure expo-camera settings are configured specifically for a 1:1 ratio, not just cropped via CSS/styles after capture.  
   * **Output Resolution:** Final square photos must be **1600x1600**, matching the eBay native app's output size. Capture must request the device's full-resolution photo preset (not a lower default preset shared with video recording), then crop/resize down to 1600x1600 — never upscale a lower-resolution capture up to 1600x1600, as that produces visibly blurry output.  
2. **Thumbnail Strip (Bottom):**  
   * A horizontal scrolling row at the bottom of the screen displaying thumbnails of the photos taken in the *current* SKU session.  
   * **Deletion Action:** Tapping a thumbnail should immediately prompt for deletion (or delete directly) and remove the image from the current session's queue.  
3. **Capture Button:** The primary shutter button to take a photo.  
4. **"Done" / "Upload" Button:** A button to finalize the capture session for the current SKU and close the Camera View, returning to the Home View.
5. **Photo Count Limit:** The session is capped at a maximum of **24 photos per SKU**, matching the eBay listing photo limit.  
   * **Display:** The photo counter must be shown in `#/24` format (e.g., `3/24`), replacing a plain count.  
   * **Behavior:** Once 24 photos have been captured, the capture button becomes disabled — no further photos can be taken until one is deleted from the session queue.

**Underlying Logic & Data Flow (Camera View):**

1. **Local Caching & Album:**  
   * When the capture button is pressed, the image is taken and immediately shown in the thumbnail strip directly from the camera's own temp cache file — no crop/resize happens per-shot, so the shutter stays responsive for rapid consecutive captures.  
   * The square crop, downsize to 1600x1600, and the high-res 1:1 Camera Roll backup save all happen **in a single batch when "Done" is tapped** (not per-shot) — see "Session Completion" below. A processing indicator (spinner) is shown on the Camera View for the duration of this batch, blocking further input, since cropping/resizing full-resolution photos is CPU-intensive enough to cause a visible per-shot delay if done immediately after each capture.  
2. **Session Completion & Upload Trigger:**  
   * When the "Done" button is tapped: a processing spinner appears on the Camera View, then each surviving photo is cropped to a centered square, downsized to 1600x1600 (if larger), saved to the Camera Roll, and copied into the session's local folder with its final name. Once all photos are processed, the Camera View closes (returns to Home View) and the "ready for upload" alert is shown.  
   * **Upload Trigger:** This action initiates the background upload process to Cloudflare R2 for all images currently held in the session queue (i.e., those not deleted).  
3. **R2 Structuring & Naming:**  
   * **Path Structure:** Images must be uploaded to the specific path defined by the Home View: /{Date Root Folder}/{SKU}/  
   * **Naming Convention:** Files must be named according to the SKU and the sequence they were taken in the final queue: \<SKU\>\_NN.jpg  
   * **Sequence (NN):** Must be a two-digit numerical sequence starting at 01 (e.g., SKU123\_01.jpg, SKU123\_02.jpg).

## **Technical Guidelines for Claude Code**

* **Context:** Assume Phase 1 (basic camera functionality and permissions using expo-camera) is already implemented and working in the codebase.  
* **State Management:** Implement necessary state management to track the current date root, the active SKU, and the array of captured images for the active session.  
* **Expo Camera:** Utilize expo-camera's ratio settings (e.g., ratio="1:1") to ensure hardware-level square capture if supported by the device, minimizing post-capture processing. Also set `pictureSize="Photo"` to request the device's full-resolution still-photo preset — the default preset is shared with video recording and caps resolution well below what's needed for a 1600x1600 output.  
* **File System & Media Library:** Use expo-file-system for cache management and expo-media-library to save images to the device's camera roll.  
* **R2 Integration:** NO R2 integration is needed for this phase, just do the local save , and pop up a alert showing images would be uploaded to R2 at that point. Do no complicate this phase with any R2 related code
* **Navigation:** Implement basic navigation (e.g., using react-navigation if already configured, or simple conditional rendering if keeping dependencies minimal at this stage) to switch between the Home View and Camera View.