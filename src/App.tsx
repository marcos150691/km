import * as React from 'react';
import { 
  Bike, 
  Play, 
  Square, 
  History, 
  Wrench, 
  ChevronRight, 
  MapPin, 
  Clock, 
  RotateCcw,
  Plus,
  Trash2,
  Navigation
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { format } from 'date-fns';
import { Trip, MotoState, MaintenanceRecord } from './types';
import { cn, formatDistance, calculateDistance } from './lib/utils';

const STORAGE_KEY = 'moto_tracker_state';

const initialState: MotoState = {
  totalKm: 0,
  trips: [],
  maintenance: [],
  lastMaintenanceKm: 0,
};

export default function App() {
  const [state, setState] = React.useState<MotoState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    return saved ? JSON.parse(saved) : initialState;
  });

  const [activeTrip, setActiveTrip] = React.useState<Trip | null>(null);
  const [view, setView] = React.useState<'dashboard' | 'history' | 'maintenance'>('dashboard');
  const [trackingError, setTrackingError] = React.useState<string | null>(null);
  const [targetKmInput, setTargetKmInput] = React.useState<string>('');
  const [alertTriggered, setAlertTriggered] = React.useState(false);

  const audioContextRef = React.useRef<AudioContext | null>(null);

  const playAlertSound = (freq = 880, duration = 0.2) => {
    try {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
      const ctx = audioContextRef.current;
      
      // Resume context if suspended (browser security)
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(freq * 1.5, ctx.currentTime + 0.05);
      
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + duration);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch (e) {
      console.error('Failed to play sound', e);
    }
  };

  // Watch for active trip in local storage for crash recovery
  React.useEffect(() => {
    const savedActive = localStorage.getItem('active_trip');
    if (savedActive) {
      setActiveTrip(JSON.parse(savedActive));
    }
  }, []);

  React.useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  React.useEffect(() => {
    if (activeTrip) {
      localStorage.setItem('active_trip', JSON.stringify(activeTrip));
    } else {
      localStorage.removeItem('active_trip');
    }
  }, [activeTrip]);

  // Tracking Logic
  React.useEffect(() => {
    let watchId: number | null = null;

    if (activeTrip && activeTrip.status === 'active') {
      if ('geolocation' in navigator) {
        watchId = navigator.geolocation.watchPosition(
          (position) => {
            const { latitude: lat, longitude: lng } = position.coords;
            const now = Date.now();

            setActiveTrip(prev => {
              if (!prev) return null;
              
              const lastPoint = prev.points[prev.points.length - 1];
              
              if (!lastPoint) {
                return {
                  ...prev,
                  points: [{ lat, lng, timestamp: now }]
                };
              }

              const dist = calculateDistance(lastPoint.lat, lastPoint.lng, lat, lng);
              // Only update if moved more than 2 meters to avoid jitter but still accumulate
              // We return prev without adding the point if it's too close, 
              // so the next update compares with the same lastPoint.
              if (dist < 0.002) return prev;

              return {
                ...prev,
                distance: prev.distance + dist,
                points: [...prev.points, { lat, lng, timestamp: now }]
              };
            });
          },
          (error) => {
            console.error('Geolocation error:', error);
            setTrackingError('GPS Signal: Weak');
          },
          { enableHighAccuracy: true }
        );
      }
    }

    return () => {
      if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    };
  }, [activeTrip?.status === 'active']);

  // Check for target distance
  React.useEffect(() => {
    if (activeTrip && activeTrip.status === 'active' && activeTrip.targetDistance) {
      if (activeTrip.distance >= activeTrip.targetDistance && !alertTriggered) {
        setAlertTriggered(true);
        // Play 3 distinct bips
        playAlertSound(1000, 0.15); // Bip 1
        setTimeout(() => playAlertSound(1000, 0.15), 300); // Bip 2
        setTimeout(() => playAlertSound(1000, 0.15), 600); // Bip 3
      }
    }
  }, [activeTrip?.distance, activeTrip?.targetDistance, alertTriggered]);

  const startTrip = () => {
    // Unlock audio on user interaction
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume();
    }
    
    const target = parseFloat(targetKmInput);
    const newTrip: Trip = {
      id: crypto.randomUUID(),
      startTime: Date.now(),
      distance: 0,
      targetDistance: !isNaN(target) && target > 0 ? target : undefined,
      points: [],
      status: 'active',
    };
    setActiveTrip(newTrip);
    setTrackingError(null);
    setAlertTriggered(false);
  };

  const stopTrip = () => {
    if (!activeTrip) return;

    const completedTrip: Trip = {
      ...activeTrip,
      endTime: Date.now(),
      status: 'completed',
    };

    setState(prev => ({
      ...prev,
      totalKm: prev.totalKm + completedTrip.distance,
      trips: [completedTrip, ...prev.trips],
    }));
    setActiveTrip(null);
  };

  const deleteTrip = (id: string) => {
    setState(prev => ({
      ...prev,
      trips: prev.trips.filter(t => t.id !== id)
    }));
  };

  const addMaintenance = (type: MaintenanceRecord['type'], notes: string = '') => {
    const record: MaintenanceRecord = {
      id: crypto.randomUUID(),
      type,
      kilometers: state.totalKm,
      date: Date.now(),
      notes,
    };

    setState(prev => ({
      ...prev,
      maintenance: [record, ...prev.maintenance],
      lastMaintenanceKm: prev.totalKm
    }));
  };

  const resetOdo = () => {
    if (confirm('Tem certeza que deseja resetar o odômetro total?')) {
      setState(initialState);
    }
  };

  const updateTotalKm = () => {
    const val = prompt('Digite o valor atual do odômetro da moto:', state.totalKm.toString());
    if (val !== null) {
      const num = parseFloat(val);
      if (!isNaN(num)) {
        setState(prev => ({ ...prev, totalKm: num }));
      }
    }
  };

  const addManualTrip = () => {
    const km = prompt('Distância percorrida (km):');
    if (km) {
      const num = parseFloat(km);
      if (!isNaN(num)) {
        const completedTrip: Trip = {
          id: crypto.randomUUID(),
          startTime: Date.now(),
          endTime: Date.now(),
          distance: num,
          points: [],
          status: 'completed',
        };
        setState(prev => ({
          ...prev,
          totalKm: prev.totalKm + num,
          trips: [completedTrip, ...prev.trips],
        }));
      }
    }
  };

  return (
    <div className="min-h-screen bg-moto-bg flex flex-col font-sans overflow-x-hidden">
      {/* Top Header / Status Bar */}
      <header className="flex items-center justify-between px-8 py-6 border-b border-moto-border bg-moto-bg/50 backdrop-blur-md sticky top-0 z-50">
          <div className="flex items-center space-x-3">
            <div className={cn(
              "w-3 h-3 rounded-full transition-shadow duration-500",
              trackingError ? "bg-red-500 shadow-[0_0_8px_#ef4444]" : 
              (activeTrip && activeTrip.points.length > 0) ? "bg-moto-primary shadow-[0_0_8px_#CCFF00]" : "bg-yellow-500 shadow-[0_0_8px_#f59e0b]"
            )}></div>
            <span className="font-mono text-[10px] tracking-widest uppercase text-moto-muted">
              {trackingError ? 'GPS Signal: Weak' : 
               (activeTrip && activeTrip.points.length === 0) ? 'GPS: Searching...' : 'GPS Signal: Strong'}
            </span>
          </div>
          
          <div className="flex items-center gap-6">
             <div className="flex flex-col items-end">
              <span className="text-[10px] text-moto-muted uppercase tracking-tighter leading-none mb-1">Total Odo</span>
              <span className="font-mono text-sm uppercase text-moto-primary font-bold">
                {(state.totalKm + (activeTrip?.distance || 0)).toFixed(1)} KM
              </span>
            </div>
          <div className="flex flex-col items-end">
            <span className="text-[10px] text-moto-muted uppercase tracking-tighter leading-none mb-1">
              {format(Date.now(), 'HH:mm')} 
            </span>
            <span className="font-mono text-sm uppercase">Brasil</span>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto p-4 md:p-8 space-y-4 md:space-y-0 md:grid md:grid-cols-12 md:gap-1 bg-moto-border">
        {/* Main Interface */}
        <div className="md:col-span-8 bg-moto-bg p-6 md:p-12 flex flex-col justify-center relative overflow-hidden min-h-[400px]">
          <div className="absolute top-8 left-10 hidden md:block">
            <h2 className="text-moto-muted text-[10px] font-bold uppercase tracking-[0.3em]">Odômetro Principal</h2>
          </div>
          
          <div className="flex items-baseline space-x-4">
            <span className="text-7xl md:text-[140px] font-bold tracking-tighter leading-none mono-display">
              {(state.totalKm + (activeTrip?.distance || 0)).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
            </span>
            <span className="text-xl md:text-4xl font-light text-moto-muted">KM</span>
            <button 
              onClick={updateTotalKm}
              className="ml-4 p-2 text-moto-muted hover:text-moto-primary transition-colors"
            >
              <Wrench className="w-4 h-4 md:w-6 md:h-6" />
            </button>
          </div>

          <div className="mt-8 md:mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 md:gap-12 border-t border-moto-border pt-8 md:pt-12">
            <div>
              <p className="text-moto-muted text-[10px] uppercase tracking-widest mb-2 font-bold">Esta Viagem (Trip A)</p>
              <div className="flex items-baseline space-x-2">
                <span className={cn(
                  "text-4xl md:text-5xl font-mono font-medium",
                  activeTrip ? "text-moto-primary" : "text-moto-muted"
                )}>
                  {formatDistance(activeTrip?.distance || 0).split(' ')[0]}
                </span>
                <span className="text-sm md:text-lg text-moto-muted">
                  {formatDistance(activeTrip?.distance || 0).split(' ')[1] || 'KM'}
                </span>
              </div>
            </div>

            {activeTrip?.targetDistance && (
              <div className="relative group">
                <p className="text-moto-primary text-[10px] uppercase tracking-widest mb-2 font-bold flex items-center gap-2">
                  <Navigation className="w-3 h-3" />
                  Meta Ativa
                </p>
                <div className="flex items-baseline space-x-2">
                  <span className="text-4xl md:text-5xl font-mono font-bold text-white">
                    {((activeTrip.distance / activeTrip.targetDistance) * 100).toFixed(0)}
                  </span>
                  <span className="text-sm md:text-lg text-moto-primary font-bold">%</span>
                </div>
                <div className="mt-2 w-full h-1.5 bg-moto-surface border border-moto-border overflow-hidden">
                  <motion.div 
                    initial={{ width: 0 }}
                    animate={{ width: `${Math.min(100, (activeTrip.distance / activeTrip.targetDistance) * 100)}%` }}
                    className={cn(
                      "h-full transition-all duration-500",
                      alertTriggered ? "bg-red-500 shadow-[0_0_15px_#ef4444]" : "bg-moto-primary shadow-[0_0_10px_#CCFF00]"
                    )}
                  />
                </div>
                <p className="mt-1 text-[10px] font-mono text-moto-muted font-bold">
                  {activeTrip.distance.toFixed(1)} / {activeTrip.targetDistance} KM
                </p>
              </div>
            )}

            <div>
              <p className="text-moto-muted text-[10px] uppercase tracking-widest mb-2 font-bold">Última Viagem</p>
              <div className="flex items-baseline space-x-2">
                <span className="text-4xl md:text-5xl font-mono font-medium">
                  {formatDistance(state.trips[0]?.distance || 0).split(' ')[0]}
                </span>
                <span className="text-sm md:text-lg text-moto-muted">
                  {formatDistance(state.trips[0]?.distance || 0).split(' ')[1] || 'KM'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Side Stats Panel */}
        <aside className="md:col-span-4 flex flex-col gap-1 md:gap-1">
          <div className="bg-moto-surface p-8 flex flex-col justify-center min-h-[140px]">
            <p className="status-label">Estimativa Mês</p>
            <div className="flex items-baseline space-x-2">
              <span className="text-5xl md:text-6xl font-bold italic">
                {state.trips.reduce((acc, t) => acc + t.distance, 0).toFixed(0)}
              </span>
              <span className="text-lg font-medium opacity-50">KM</span>
            </div>
          </div>
          
          <div className="bg-moto-surface p-8 flex flex-col justify-center min-h-[140px]">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="status-label">Viagens</p>
                <p className="text-2xl font-mono">{state.trips.length}</p>
              </div>
              <div>
                <p className="status-label">Duração Avg</p>
                <p className="text-2xl font-mono">--<span className="text-xs ml-1 font-sans">M</span></p>
              </div>
            </div>
          </div>

          <div className="bg-moto-surface p-8 flex flex-col justify-center min-h-[140px]">
             <p className="status-label">Intervalo de Serviço</p>
             <div className="w-full h-1 bg-moto-border rounded-full overflow-hidden mt-2">
                <div 
                  className={cn(
                    "h-full transition-all duration-1000",
                    (state.totalKm - state.lastMaintenanceKm) > 2800 ? "bg-red-500" : "bg-moto-primary"
                  )}
                  style={{ width: `${Math.min(100, ((state.totalKm - state.lastMaintenanceKm) / 3000) * 100)}%` }}
                ></div>
             </div>
             <p className="mt-3 text-[10px] text-right text-moto-muted uppercase tracking-wider font-bold">
               Próximo em <span className="text-moto-text font-mono underline decoration-moto-primary">
                 {Math.max(0, 3000 - (state.totalKm - state.lastMaintenanceKm)).toFixed(0)} KM
               </span>
             </p>
          </div>
        </aside>
      </main>

      {/* Tabs / Sub-views Navigation Container */}
      <section className="max-w-7xl w-full mx-auto px-4 md:px-0 py-8">
        <AnimatePresence mode="wait">
          {view === 'history' && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between mb-4 border-b border-moto-border pb-4">
                <h3 className="font-mono text-sm tracking-[0.3em] uppercase text-moto-muted">Log History</h3>
                <button onClick={addManualTrip} className="text-[10px] uppercase font-bold text-moto-primary border border-moto-primary/30 px-3 py-1 hover:bg-moto-primary hover:text-black">Add Manual</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                {state.trips.map(trip => (
                  <div key={trip.id} className="bg-moto-surface border border-moto-border p-6 flex justify-between items-center group">
                    <div>
                      <p className="font-mono text-2xl font-bold leading-none">{trip.distance.toFixed(1)} <span className="text-[10px] font-sans text-moto-primary">KM</span></p>
                      <p className="text-[10px] text-moto-muted mt-2 font-medium tracking-widest">{format(trip.startTime, 'MMM dd, yyyy · HH:mm')}</p>
                    </div>
                    <button onClick={() => deleteTrip(trip.id)} className="text-moto-muted hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition-opacity">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {view === 'maintenance' && (
             <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="space-y-4"
            >
              <div className="flex items-center justify-between mb-4 border-b border-moto-border pb-4">
                <h3 className="font-mono text-sm tracking-[0.3em] uppercase text-moto-muted">Maintenance Fleet Log</h3>
                <button 
                  onClick={() => {
                    const type = prompt('Tipo de manutenção (óleo, pneu, corrente, freio):') as any;
                    if (type) addMaintenance(type);
                  }}
                  className="text-[10px] uppercase font-bold text-moto-primary border border-moto-primary/30 px-3 py-1 hover:bg-moto-primary hover:text-black"
                >Record Service</button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {state.maintenance.map(record => (
                  <div key={record.id} className="bg-moto-surface border border-moto-border p-6 flex justify-between items-center">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <Wrench className="w-3 h-3 text-moto-primary" />
                        <p className="font-mono text-sm uppercase tracking-widest font-bold">{record.type}</p>
                      </div>
                      <p className="text-[10px] text-moto-muted font-medium tracking-widest">{format(record.date, 'MMM dd, yyyy')}</p>
                    </div>
                    <p className="font-mono text-xl">{record.kilometers.toFixed(0)} <span className="text-[10px] font-sans text-moto-muted">KM</span></p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </section>

      {/* Global Footer Controls */}
      <footer className="h-24 md:h-24 bg-moto-bg border-t border-moto-border flex items-center justify-between px-6 md:px-10 fixed bottom-0 left-0 right-0 z-50">
        <div className="flex items-center gap-2 md:space-x-6">
          <button 
            onClick={() => setView(view === 'history' ? 'dashboard' : 'history')}
            className={cn(
              "px-4 md:px-6 py-2 border text-[9px] md:text-[11px] uppercase tracking-[0.2em] transition-all font-bold",
              view === 'history' ? "bg-white text-black border-white" : "border-moto-border text-moto-muted hover:bg-white hover:text-black"
            )}
          >
            History
          </button>
          <button 
            onClick={() => setView(view === 'maintenance' ? 'dashboard' : 'maintenance')}
            className={cn(
              "px-4 md:px-6 py-2 border text-[9px] md:text-[11px] uppercase tracking-[0.2em] transition-all font-bold",
              view === 'maintenance' ? "bg-white text-black border-white" : "border-moto-border text-moto-muted hover:bg-white hover:text-black"
            )}
          >
            Service
          </button>
          <button 
             onClick={resetOdo}
             className="p-2 text-moto-muted hover:text-red-500 hidden md:block"
          >
            <RotateCcw className="w-4 h-4" />
          </button>
        </div>

        <div className="flex items-center space-x-4 md:space-x-8">
          <div className="flex flex-col items-end hidden sm:flex">
            <span className="text-[10px] uppercase text-moto-muted tracking-widest font-bold">App Status</span>
            <span className="font-mono text-xs">{activeTrip ? 'Tracking Active' : 'Dashboard Idle'}</span>
          </div>
          
          {!activeTrip ? (
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-end gap-1">
                {[5, 10, 20, 50, 100].map(val => (
                  <button 
                    key={val}
                    type="button"
                    onClick={() => setTargetKmInput(val.toString())}
                    className={cn(
                      "px-2 py-1 text-[9px] font-mono border transition-all duration-200 uppercase tracking-tighter",
                      targetKmInput === val.toString() 
                        ? "bg-moto-primary text-black border-moto-primary font-bold shadow-[0_0_10px_#CCFF0033]" 
                        : "border-moto-border text-moto-muted hover:border-moto-primary/50"
                    )}
                  >
                    {val}km
                  </button>
                ))}
                <button 
                  type="button"
                  onClick={() => setTargetKmInput('')}
                  className={cn(
                    "px-2 py-1 text-[9px] font-mono border border-moto-border text-moto-muted hover:border-red-500 transition-colors uppercase tracking-tighter",
                    targetKmInput === '' && "opacity-50"
                  )}
                >
                  no limit
                </button>
              </div>
              
              <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                  <span className="text-[9px] uppercase text-moto-muted tracking-widest font-bold">Definir Meta Manual</span>
                  <div className="relative">
                    <input 
                      type="number"
                      placeholder="KM"
                      value={targetKmInput}
                      onChange={(e) => setTargetKmInput(e.target.value)}
                      className="bg-moto-surface border border-moto-border text-sm w-28 px-3 py-2 font-mono focus:outline-none focus:border-moto-primary transition-all text-right pr-8"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-moto-muted font-mono">KM</span>
                  </div>
                </div>
                <button 
                  onClick={startTrip}
                  className="h-12 md:h-14 px-8 md:px-16 bg-moto-primary text-black font-black uppercase tracking-[0.2em] text-xs md:text-sm hover:opacity-90 active:scale-95 transition-all shadow-[0_0_30px_rgba(204,255,0,0.4)] flex items-center gap-3"
                >
                  <Play className="w-5 h-5 fill-black" />
                  <span className="hidden xs:inline">Iniciar Viagem</span>
                  <span className="xs:hidden">Start</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-4">
              {activeTrip.targetDistance && (
                <div className="hidden sm:flex flex-col items-end">
                  <span className="text-[9px] uppercase text-moto-muted tracking-widest font-bold">Progresso</span>
                  <div className="flex items-baseline gap-1">
                    <span className={cn(
                      "font-mono text-xs",
                      alertTriggered ? "text-moto-primary animate-pulse" : "text-white"
                    )}>
                      {((activeTrip.distance / activeTrip.targetDistance) * 100).toFixed(0)}%
                    </span>
                    <span className="text-[9px] text-moto-muted">/ {activeTrip.targetDistance}KM</span>
                  </div>
                </div>
              )}
              <button 
                onClick={stopTrip}
                className="h-12 md:h-14 px-6 md:px-12 bg-red-500 text-white font-black uppercase tracking-[0.2em] text-xs md:text-sm hover:opacity-90 active:scale-95 transition-all shadow-[0_0_20px_rgba(239,68,68,0.3)] flex items-center gap-2"
              >
                <Square className="w-4 h-4 fill-white" />
                <span className="hidden xs:inline">Stop Ride</span>
                <span className="xs:hidden">Stop</span>
              </button>
            </div>
          )}
        </div>
      </footer>
      
      {/* Spacer for fixed footer */}
      <div className="h-24 sm:h-24"></div>
    </div>
  );
}

function TripCard({ trip, onDelete }: { trip: Trip; onDelete: (id: string) => void }) {
  return (
    <div className="dashboard-card py-4 group">
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-4">
          <div className="p-3 bg-black/40 rounded-xl">
            <MapPin className="w-5 h-5 text-moto-primary" />
          </div>
          <div>
            <p className="font-display font-black text-xl italic leading-none mb-1">
              {trip.distance.toFixed(1)} <span className="text-xs font-bold text-moto-primary not-italic">KM</span>
            </p>
            <p className="text-[10px] uppercase font-mono text-white/40 tracking-widest">
              {format(trip.startTime, 'dd MMM - HH:mm')}
            </p>
          </div>
        </div>
        <button 
          onClick={() => onDelete(trip.id)}
          className="opacity-0 group-hover:opacity-100 p-2 text-white/20 hover:text-red-500 transition-all"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

function NavButton({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-2 px-6 py-3 rounded-2xl transition-all font-display font-black uppercase text-xs tracking-tight",
        active ? "bg-moto-primary text-black" : "text-white/40 hover:text-white/80"
      )}
    >
      {React.cloneElement(icon as React.ReactElement, { className: "w-5 h-5" })}
      {active && <span>{label}</span>}
    </button>
  );
}

