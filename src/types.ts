export interface Trip {
  id: string;
  startTime: number;
  endTime?: number;
  distance: number; // in km
  targetDistance?: number; // target to reach
  points: Array<{ lat: number; lng: number; timestamp: number }>;
  status: 'active' | 'completed';
}

export interface MaintenanceRecord {
  id: string;
  type: 'oil' | 'tires' | 'chain' | 'brake' | 'general';
  kilometers: number;
  date: number;
  notes?: string;
}

export interface MotoState {
  totalKm: number;
  trips: Trip[];
  maintenance: MaintenanceRecord[];
  lastMaintenanceKm: number;
}
