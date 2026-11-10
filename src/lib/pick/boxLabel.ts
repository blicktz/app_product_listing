import type { PickLine } from './types';

// Printed storage labels are ST-<3-letter room>-<3-letter column>-<3-digit box>,
// e.g. ST-GAR-AAC-001 (garage) or ST-SHD-ABA-002 (shed). The inventory's box
// IDs use older short forms without the room, so each is mapped to its printed
// label, using the room the server sends with the box, before comparing:
//   GAR A-1 → ST-GAR-AAA-001    GAR Q1 → ST-GAR-QQQ-001    SHD AAB-10 → ST-SHD-AAB-010
//   GAR K--7 → ST-GAR-KKK-007   GAR T-3-1 → ST-GAR-TTT-003 (sub-boxes share the parent's label)

/** Used when the server sends no room for a box; most stock is in the garage. */
const DEFAULT_ROOM = 'GAR';
const LABEL_PREFIX = 'ST-';
const LABEL_SHAPE = /ST-[A-Z]{3}-[A-Z]{3}-\d{3}$/;
const ROOM_CODE = /^[A-Z]{3}$/;

// Column letters, any dashes, box number, then optional sub-box numbers.
const INVENTORY_ID = /^([A-Z]+)-*(\d+)(?:-\d+)*$/;

/** True for a scan that has the printed storage-label shape (ST-GAR-AAC-001). */
export function isStorageLabel(code: string): boolean {
  return code.startsWith(LABEL_PREFIX) && LABEL_SHAPE.test(code);
}

/**
 * A storage label at the end of a scan with stray characters in front (left
 * in the field by an interrupted scan) is the label alone.
 */
export function salvageStorageLabel(code: string): string {
  const match = LABEL_SHAPE.exec(code);
  return match && match.index > 0 ? match[0] : code;
}

/**
 * The printed label for an inventory box ID in `room`, or null when it can't
 * be built (a room that isn't a 3-letter code, or an unrecognised ID shape).
 * An ID that already is a printed label is returned as is.
 */
export function boxLabel(boxId: string, room: string | null = null): string | null {
  const id = boxId.trim().toUpperCase();
  if (isStorageLabel(id)) {
    return id;
  }
  const where = (room || DEFAULT_ROOM).trim().toUpperCase();
  if (!ROOM_CODE.test(where)) {
    return null;
  }
  const match = INVENTORY_ID.exec(id);
  if (!match) {
    return null;
  }
  const [, letters, number] = match;
  const column = letters.length === 1 ? letters.repeat(3) : letters.length === 3 ? letters : null;
  if (!column) {
    return null;
  }
  return `${LABEL_PREFIX}${where}-${column}-${number.padStart(3, '0')}`;
}

/**
 * Whether two box IDs on the list are the same labelled box (T-3 and T-3-1).
 * Both are read in one room, so this compares column and box number.
 */
export function sameBoxLabel(a: string, b: string): boolean {
  if (a.toUpperCase() === b.toUpperCase()) {
    return true;
  }
  const label = boxLabel(a);
  return label !== null && label === boxLabel(b);
}

/**
 * Scanned value → the inventory box IDs it stands for. Keys are both the
 * printed labels and the inventory IDs themselves, so an old hand-written
 * label still opens its box. A label can stand for several IDs (sub-boxes).
 */
export function boxScanIndex(lines: PickLine[]): Map<string, string[]> {
  const index = new Map<string, string[]>();
  const add = (key: string, boxId: string) => {
    const ids = index.get(key) ?? [];
    if (!ids.includes(boxId)) {
      ids.push(boxId);
    }
    index.set(key, ids);
  };

  // Other and nearby boxes come without a room: use the room the list gives
  // that box elsewhere, else the line's own room (nearby boxes stand with it).
  const roomOf = new Map<string, string>();
  for (const line of lines) {
    if (line.box_id && line.room) {
      roomOf.set(line.box_id.toUpperCase(), line.room);
    }
  }

  const addBox = (rawId: string, room: string | null) => {
    const boxId = rawId.toUpperCase();
    add(boxId, boxId);
    const label = boxLabel(boxId, roomOf.get(boxId) ?? room);
    if (label) {
      add(label, boxId);
    }
  };
  for (const line of lines) {
    if (line.box_id) {
      addBox(line.box_id, line.room);
    }
    for (const box of line.other_boxes ?? []) {
      addBox(box, line.room);
    }
    for (const nearby of line.nearby_boxes ?? []) {
      addBox(nearby.box_id, line.room);
    }
  }
  return index;
}
