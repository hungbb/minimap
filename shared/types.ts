// What the server sends to browsers. Used by both the server and the frontend.
import type { CharacterDesign } from './look.ts';

export interface Place {
  id: string;
  name: string;
  kind: 'office';
}

export interface TeamUser {
  username: string;
  nickname: string;
  place: string | null;
  status: string;
  updatedAt: string | null;
  claimed: boolean;
  /** Null means the default character chosen from the username. */
  look: CharacterDesign | null;
}

export interface Clock {
  label: string;
  timeZone: string;
}

export interface PublicSettings {
  publicUrl: string;
  clocks: Clock[];
  officeName: string;
  /** Whether the map shows the office's daylight and weather. */
  mapWeather: boolean;
}

/** When the sun rises and sets at the office on one day, as ISO instants. */
export interface SunTimes {
  rise: string;
  set: string;
}

export interface Weather {
  temperature: number;
  code: number;
  isDay: boolean;
  updatedAt: string;
  /** Yesterday, today and tomorrow at the office, so the map can light the town. Missing in polar day or night. */
  sun?: SunTimes[];
  /** Share of the sky covered by cloud, 0 to 100. */
  cloudCover?: number;
  /** Rain and snow in the last hour, in mm. */
  precipitation?: number;
  /** Wind at 10 m, in km/h. */
  windSpeed?: number;
}

export interface TeamState {
  places: Place[];
  settings: PublicSettings;
  weather: Weather | null;
  users: TeamUser[];
}

export interface OfficeLocation {
  name: string;
  latitude: number;
  longitude: number;
}

export interface AuthResult {
  token: string;
  username: string;
}
