// Synthetic exams. Students, names and answers are invented with a seeded item response model,
// so every run produces the same data.
import { pseudonym } from './importer.ts'
import type { Attempt, Exam, Item } from './types.ts'

export function rng(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const normal = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r())

const FIRST = ['Maya', 'Liam', 'Aisha', 'Noah', 'Priya', 'Ethan', 'Sofia', 'Lucas', 'Zara', 'Owen', 'Chloe', 'Arjun', 'Emma', 'Mateo', 'Hana', 'Jack', 'Leah', 'Omar', 'Grace', 'Ravi', 'Nina', 'Caleb', 'Mei', 'Tariq', 'Ivy', 'Felix', 'Amara', 'Diego', 'Elena', 'Kofi']
const LAST = ['Chen', 'Okafor', 'Singh', 'Martin', 'Nguyen', 'Tremblay', 'Garcia', 'Roy', 'Ahmed', 'Kowalski', 'Brown', 'Patel', 'Lee', 'Fraser', 'Haddad', 'Silva', 'Wong', 'Murphy', 'Dubois', 'Kaur']

const BIO = [
  'Which organelle is the site of aerobic respiration?', 'Which molecule carries amino acids to the ribosome?', 'Osmosis is the diffusion of which substance?',
  'Which bond holds the two strands of DNA together?', 'Enzymes speed reactions by lowering what?', 'Which phase of mitosis separates sister chromatids?',
  'What is the monomer of a protein?', 'Which process produces the most ATP per glucose?', 'Which structure is found in plant cells but not animal cells?',
  'Crossing over occurs during which stage?', 'A recessive phenotype appears in what fraction of an Aa x Aa cross?', 'Which base pairs with adenine in RNA?',
  'Where does the Calvin cycle take place?', 'What does the sodium-potassium pump move against its gradient?', 'Which level of protein structure is the amino acid sequence?',
  'What is the role of helicase in replication?', 'Which statement best describes a competitive inhibitor?', 'Natural selection acts directly on what?',
  'Which lipid forms the core of cell membranes?', 'What is the end product of glycolysis?', 'Which kingdom includes organisms with chitin cell walls?',
  'What is the function of the Golgi apparatus?', 'A codon is made of how many nucleotides?', 'Which molecule is the final electron acceptor in respiration?',
  'Which term describes a population\'s total set of alleles?', 'What type of bond links nucleotides in a strand?', 'Which hormone lowers blood glucose?',
  'Hardy-Weinberg equilibrium assumes which condition?', 'Which organelle contains its own circular DNA besides mitochondria?', 'What drives water up a tall tree?',
  'Which macromolecule stores genetic information?', 'What is the role of tRNA anticodons?', 'Which process creates gametes?',
  'A cell placed in a hypertonic solution will do what?', 'Which of these is a prokaryote?', 'Which pigment absorbs light for photosynthesis?',
  'What is the purpose of a control group?', 'Which structure regulates what enters the nucleus?', 'Which trophic level has the most energy?', 'What is a keystone species?',
]

export interface SampleExamDef { title: string; term: string; date: string; exam: Exam; note: string }
export interface SampleDef { id: string; name: string; course: string; blurb: string; exams: () => SampleExamDef[] }

/** Item parameters for the 40-question bank: discrimination a, difficulty b, and how attractive each distractor is. */
function bioParams(r: () => number) {
  return BIO.map((_, j) => ({
    a: 1.0 + r() * 1.2,
    b: -1.0 + r() * 2.0,
    key: 'ABCD'[Math.floor(r() * 4)],
    w: [0.8 + r() * 0.4, 0.8 + r() * 0.4, 0.7 + r() * 0.4],
    j,
  }))
}

function bioExam(seed: number, n: number, shift: number, opts: { miskey?: number; nfd?: number }): Exam {
  const r = rng(seed)
  const params = bioParams(rng(4242))
  const items: Item[] = params.map((p, j) => ({ id: `q${j + 1}`, label: `Q${j + 1}`, stem: BIO[j], maxPoints: 1, key: [p.key], options: ['A', 'B', 'C', 'D'], bankKey: `bio-${j + 1}` }))
  // The miskeyed item: the answer key says the next letter over, but students who know the material choose the true answer.
  const keyed = items.map(it => it.key![0])
  if (opts.miskey !== undefined) {
    const t = keyed[opts.miskey]
    const wrong = 'ABCD'[('ABCD'.indexOf(t) + 1) % 4]
    items[opts.miskey] = { ...items[opts.miskey], key: [wrong] }
  }
  const attempts: Attempt[] = []
  for (let s = 0; s < n; s++) {
    const theta = normal(r) + shift
    const choices: string[] = []
    const scores: number[] = []
    params.forEach((p, j) => {
      const prob = 0.12 + 0.88 / (1 + Math.exp(-p.a * (theta - p.b)))
      let choice: string
      if (r() < prob) choice = p.key
      else {
        const others = 'ABCD'.split('').filter(c => c !== p.key)
        let w = [...p.w]
        if (j === opts.nfd) w = [w[0], w[1], 0.012]
        if (j === opts.miskey) {
          // The keyed letter is a plausible wrong answer that weaker students fall for.
          const kIdx = others.indexOf(items[j].key![0])
          w = w.map((x, i) => (i === kIdx ? x + 1.2 : x))
        }
        const tw = w.reduce((a, b) => a + b, 0)
        let x = r() * tw, i = 0
        while (x > w[i] && i < 2) { x -= w[i]; i++ }
        choice = others[i]
      }
      choices.push(choice)
      scores.push(items[j].key!.includes(choice) ? 1 : 0)
    })
    const first = FIRST[Math.floor(r() * FIRST.length)], last = LAST[Math.floor(r() * LAST.length)]
    const lmsId = String(300100 + s + seed % 1000 * 1000)
    attempts.push({ id: pseudonym(lmsId, 'bio110'), lmsId, username: `${first[0].toLowerCase()}${last.toLowerCase()}${s % 97}`, name: `${first} ${last}`, scores, choices })
  }
  return { items, attempts }
}

const STATS = [
  ['Compute the mean of the listed data set.', 1], ['Find the median and explain why it differs from the mean.', 2], ['Read the standard deviation from the output.', 1],
  ['Interpret a z-score of -1.5 in context.', 2], ['Choose the correct sampling method for the scenario.', 1], ['State null and alternative hypotheses.', 2],
  ['Compute a 95% confidence interval for the mean.', 3], ['Interpret the p-value in plain language.', 2], ['Identify the explanatory variable.', 1],
  ['Describe the scatterplot: form, direction, strength.', 3], ['Compute r-squared from r = 0.6.', 1], ['Explain why correlation is not causation here.', 2],
] as const

function statsExam(): Exam {
  const r = rng(77)
  const items: Item[] = STATS.map(([stem, mp], j) => ({ id: `q${j + 1}`, label: `Q${j + 1}`, stem, maxPoints: mp, bankKey: `stat-${j + 1}` }))
  const attempts: Attempt[] = []
  for (let s = 0; s < 25; s++) {
    const theta = normal(r) + 0.3
    const scores = STATS.map(([, mp], j) => {
      const b = [-1.2, -0.3, -1, 0.2, -0.8, -0.2, 0.9, 0.6, -1.4, 0.4, -0.6, 1.1][j]
      // Q9 is a reversed item: everyone gets it, and the weakest students slightly more often.
      const prob = j === 8 ? Math.min(0.97, Math.max(0.3, 0.72 - 0.3 * theta)) : 1 / (1 + Math.exp(-1.3 * (theta - b)))
      let pts = 0
      for (let k = 0; k < mp; k++) if (r() < prob) pts++
      return Math.min(mp, pts)
    })
    const first = FIRST[(s * 7) % FIRST.length], last = LAST[(s * 3) % LAST.length]
    const lmsId = `51${String(s + 1).padStart(4, '0')}`
    attempts.push({ id: pseudonym(lmsId, 'stat201'), lmsId, username: `${first.toLowerCase()}.${last.toLowerCase()}`, name: `${first} ${last}`, scores })
  }
  return { items, attempts }
}

export const SAMPLES: SampleDef[] = [
  {
    id: 'bio110', name: 'BIO 110 Intro Biology', course: 'BIO 110',
    blurb: '40-question midterm, 180 students, two terms of history. One item is miskeyed and one distractor does no work.',
    exams: () => [
      { title: 'Midterm 1', term: 'Fall 2025', date: '2025-10-16', exam: bioExam(11, 164, 0, {}), note: 'Same 40 items, keyed correctly.' },
      { title: 'Midterm 1', term: 'Winter 2026', date: '2026-02-19', exam: bioExam(29, 180, 0.1, { miskey: 16, nfd: 8 }), note: 'Q17 was rekeyed by mistake when the bank was edited.' },
    ],
  },
  {
    id: 'stat201', name: 'STAT 201 Quiz 3', course: 'STAT 201',
    blurb: '12 short-answer items with partial credit, 25 students. Reliability from Cronbach\'s alpha, not KR-20.',
    exams: () => [{ title: 'Quiz 3: Inference', term: 'Winter 2026', date: '2026-03-05', exam: statsExam(), note: 'Partial credit, no option data.' }],
  },
]
