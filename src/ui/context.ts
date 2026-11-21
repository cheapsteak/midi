import { createContext, useContext } from 'react';
import { useStore } from 'zustand';
import type { MidiInputs } from '../midi/createMidiInput';
import type { PracticeSession } from '../session/practiceSession';
import type { AppState, AppStore } from '../session/store';

export interface AppServices {
  store: AppStore;
  session: PracticeSession;
  midi: MidiInputs;
}

export const AppContext = createContext<AppServices | null>(null);

export function useServices(): AppServices {
  const services = useContext(AppContext);
  if (!services) throw new Error('AppContext missing');
  return services;
}

export function useAppState<T>(selector: (state: AppState) => T): T {
  return useStore(useServices().store, selector);
}
