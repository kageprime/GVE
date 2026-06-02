export const wsClients = new Set<any>();
export const sessionClients = new Map<string, Set<any>>();
export let wsEventSequence = 0;
export const eventReplayBuffer: any[] = [];

export function incrementWsEventSequence(): number {
  return ++wsEventSequence;
}
