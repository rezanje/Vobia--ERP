export const STAGES = ['trial', 'mass_production', 'qc', 'completed', 'canceled'] as const
export type Stage = (typeof STAGES)[number]

const TRANSITIONS: Record<Stage, Stage[]> = {
  trial: ['mass_production', 'canceled'],
  mass_production: ['qc', 'canceled'],
  qc: ['completed', 'mass_production', 'canceled'],
  completed: [],
  canceled: [],
}

export function nextStages(stage: string): Stage[] {
  return TRANSITIONS[stage as Stage] ?? []
}
