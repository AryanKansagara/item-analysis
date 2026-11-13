/** One question on one exam sitting. */
export interface Item {
  id: string
  /** Short label shown in tables, e.g. "Q17". */
  label: string
  /** Question text when the export includes it. Used to key the item across terms. */
  stem?: string
  maxPoints: number
  /** Brightspace bonus question: its points add to the score but not to the maximum. */
  bonus?: boolean
  /** Correct option letters (multiple-choice only). */
  key?: string[]
  /** Option letters seen for this item, in order. */
  options?: string[]
  /** Stable identity across terms. Defaults to a hash of the stem, else the label. */
  bankKey: string
}

/** One student's attempt. `id` is a pseudonym; the LMS identifiers stay on this device. */
export interface Attempt {
  id: string
  /** OrgDefinedId / Canvas user id / Moodle email, needed to build a grade import. Local only. */
  lmsId?: string
  username?: string
  /** Display name. Local only and droppable. */
  name?: string
  scores: (number | null)[]
  choices?: (string | null)[]
}

export interface Exam {
  items: Item[]
  attempts: Attempt[]
}

export type AdjustKind = 'drop' | 'full' | 'accept'
export interface Adjustment { itemId: string; kind: AdjustKind; accept?: string[] }

export interface Band { label: string; min: number }
export const DEFAULT_BANDS: Band[] = [
  { label: 'A', min: 90 }, { label: 'B', min: 80 }, { label: 'C', min: 70 }, { label: 'D', min: 60 }, { label: 'F', min: 0 },
]

export interface Thresholds { easy: number; hard: number; weakD: number; nfd: number }
export const DEFAULT_THRESHOLDS: Thresholds = { easy: 0.9, hard: 0.3, weakD: 0.2, nfd: 0.05 }
