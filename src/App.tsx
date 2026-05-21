import { useState, useEffect, useRef } from 'react';
import { Play, Square, AlertCircle, MapPin, Clock, BatteryMedium, Zap, Coins } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

// Constantes Técnicas do Veículo / Negócio
const AUTONOMIA_MAXIMA = 76; // Em km
const VELOCIDADE_MEDIA = 24; // Em km/h
const PRECO_KWH = 1.02534591194969; // Em R$
const KWH_CARGA_TOTAL = 1.7; // Em kWh
const TEMPO_CARGA_POR_1_PORCENTO = 4; // Em minutos

// Helper para formatar tempo no formato HH:MM
function formatTimeHHMM(totalMinutes: number): string {
  if (totalMinutes <= 0 || isNaN(totalMinutes)) return "00:00";
  const hours = Math.floor(totalMinutes / 60);
  const minutes = Math.floor(totalMinutes % 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
}

// 1. Tempo Estimado de Viagem
// Fórmula: (Distância / VELOCIDADE_MEDIA) * 60 para obter minutos totais. Arredondado para cima.
function getEstimatedTravelTime(distanceKm: number): string {
  if (distanceKm <= 0) return "00:00";
  const totalMinutes = Math.ceil((distanceKm / VELOCIDADE_MEDIA) * 60);
  return formatTimeHHMM(totalMinutes);
}

// 2. Porcentagem da Bateria Consumida
// Fórmula: (Distância / AUTONOMIA_MAXIMA) * 100. Retorna string com vírgula e 2 casas decimais.
function getBatteryPercentageConsumed(distanceKm: number): string {
  if (distanceKm <= 0) return "0,00";
  const percentage = (distanceKm / AUTONOMIA_MAXIMA) * 100;
  return percentage.toFixed(2).replace('.', ',');
}

// 3. Tempo de Recarga Necessário
// Fórmula: Porcentagem da Bateria (sem arredondar) * TEMPO_CARGA_POR_1_PORCENTO. Arredondado para cima.
function getRechargeTime(distanceKm: number): string {
  if (distanceKm <= 0) return "00:00";
  const percentage = (distanceKm / AUTONOMIA_MAXIMA) * 100; 
  const totalMinutes = Math.ceil(percentage * TEMPO_CARGA_POR_1_PORCENTO);
  return formatTimeHHMM(totalMinutes);
}

// 4. Custo da Viagem (R$)
// Fórmula custo por km: (PRECO_KWH * KWH_CARGA_TOTAL) / AUTONOMIA_MAXIMA
function getTravelCost(distanceKm: number): string {
  if (distanceKm <= 0) return "0,00";
  const costPerKm = (PRECO_KWH * KWH_CARGA_TOTAL) / AUTONOMIA_MAXIMA;
  const totalCost = distanceKm * costPerKm;
  return totalCost.toFixed(2).replace('.', ',');
}

// Haversine formula to calculate distance between two coordinates in meters
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371e3; // Earth radius in meters
  const toRadians = (deg: number) => (deg * Math.PI) / 180;
  
  const phi1 = toRadians(lat1);
  const phi2 = toRadians(lat2);
  const deltaPhi = toRadians(lat2 - lat1);
  const deltaLambda = toRadians(lon2 - lon1);

  const a = Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
            Math.cos(phi1) * Math.cos(phi2) *
            Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export default function App() {
  const [isTracking, setIsTracking] = useState(false);
  const [speed, setSpeed] = useState<number>(0);
  const [distance, setDistance] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);

  const [showReport, setShowReport] = useState(false);
  const [isStopped, setIsStopped] = useState(true);

  const watchIdRef = useRef<number | null>(null);
  const lastPositionRef = useRef<{ lat: number; lon: number; timestamp: number } | null>(null);

  const startTracking = () => {
    setError(null);
    if (!('geolocation' in navigator)) {
      setError('Geolocalização não suportada pelo seu navegador.');
      return;
    }

    setIsTracking(true);
    setShowReport(false);
    setDistance(0);
    setSpeed(0);
    setIsStopped(true);
    lastPositionRef.current = null;

    watchIdRef.current = navigator.geolocation.watchPosition(
      (position) => {
        // Limpa erros anteriores após obter uma resposta válida do GPS
        setError(null);

        const { latitude, longitude, speed: deviceSpeed, accuracy: deviceAccuracy } = position.coords;
        const timestamp = position.timestamp;

        setAccuracy(deviceAccuracy);

        let currentSpeedKmh = 0;
        let distCovered = 0;

        if (lastPositionRef.current) {
          const prevPos = lastPositionRef.current;
          distCovered = calculateDistance(prevPos.lat, prevPos.lon, latitude, longitude);
          const timeElapsed = (timestamp - prevPos.timestamp) / 1000; // em segundos

          // Se o dispositivo fornece a velocidade, damos prioridade alta para ela
          if (deviceSpeed !== null && deviceSpeed >= 0) {
            currentSpeedKmh = deviceSpeed * 3.6;
          } else if (timeElapsed > 0.05) {
            currentSpeedKmh = (distCovered / timeElapsed) * 3.6;
          }

          // Para corrida a pé / caminhada, a velocidade pode ser baixa.
          // Baixamos o limiar de parada para 1.0 km/h para registrar deslocamento a pé com alta sensibilidade.
          if (currentSpeedKmh < 1.0) {
            setIsStopped(true);
            setSpeed(0);
          } else {
            setIsStopped(false);
            setSpeed(currentSpeedKmh);
            
            // Permite uma tolerância maior de precisão (até 50 metros) em dispositivos móveis
            // para evitar o descarte de dados legítimos ao se deslocar a pé.
            if (deviceAccuracy < 50) {
              // Evita picos absurdos de erro de medição GPS (pulsações irreais acima de 120 km/h)
              if (currentSpeedKmh < 120) {
                setDistance((prev) => prev + distCovered);
              }
            }
          }
        } else {
          // Primeira medição inicial
          if (deviceSpeed !== null && deviceSpeed >= 0) {
            currentSpeedKmh = deviceSpeed * 3.6;
            if (currentSpeedKmh < 1.0) {
              setIsStopped(true);
              setSpeed(0);
            } else {
              setIsStopped(false);
              setSpeed(currentSpeedKmh);
            }
          } else {
            setIsStopped(true);
            setSpeed(0);
          }
        }

        lastPositionRef.current = { lat: latitude, lon: longitude, timestamp };
      },
      (error) => {
        // IMPORTANTE: NÃO pare o rastreamento em caso de erro de timeout ou sinal fraco!
        // Apenas erros fatais (ex: permissão negada) devem desativar o rastreamento.
        if (error.code === error.PERMISSION_DENIED) {
          setIsTracking(false);
          setIsStopped(true);
          setError('Permissão de GPS negada. Ative a localização nas configurações.');
          if (watchIdRef.current !== null) {
            navigator.geolocation.clearWatch(watchIdRef.current);
            watchIdRef.current = null;
          }
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          setError('Sinal de GPS fraco. Aguardando conexão mais precisa...');
        } else if (error.code === error.TIMEOUT) {
          setError('Procurando sinal de GPS... Mantenha o celular ao ar livre.');
        } else {
          setError('Conexão GPS instável. Tentando reconectar...');
        }
      },
      {
        enableHighAccuracy: true,
        maximumAge: 0,
        timeout: 12000, // Aumentado para 12 segundos para dar tempo do chip GPS inicializar sem falhar
      }
    );
  };

  const stopTracking = () => {
    if (watchIdRef.current !== null) {
      navigator.geolocation.clearWatch(watchIdRef.current);
      watchIdRef.current = null;
    }
    setIsTracking(false);
    lastPositionRef.current = null;
    setSpeed(0);
    setIsStopped(true);
    setShowReport(true);
  };

  const closeReport = () => {
    setShowReport(false);
    setDistance(0);
  };

  useEffect(() => {
    return () => {
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current);
      }
    };
  }, []);

  const formatDistance = (meters: number) => {
    if (meters < 1000) {
      return `${Math.floor(meters)} m`;
    }
    return `${(meters / 1000).toFixed(2)} km`;
  };

  return (
    <div className="min-h-[100dvh] bg-black text-white flex flex-col items-center justify-between p-4 sm:p-6 font-sans selection:bg-emerald-500/30">
      {/* Header */}
      <header className="w-full flex items-center justify-end pt-2 min-h-[32px]">
        {accuracy && isTracking && (
          <div className="text-xs font-mono text-white/50 flex items-center gap-1.5 bg-white/5 px-2.5 py-1 rounded-full">
            <span className={`w-2 h-2 rounded-full ${accuracy < 15 ? 'bg-emerald-500' : accuracy < 30 ? 'bg-yellow-500' : 'bg-red-500'}`} />
            Prec: {Math.floor(accuracy)}m
          </div>
        )}
      </header>

      {/* Main Display */}
      <main className="flex-1 flex flex-col items-center justify-center w-full max-w-sm gap-8 sm:gap-10 py-6">
        
        {/* Speedometer Ring */}
        <div className="relative w-56 h-56 sm:w-72 sm:h-72 shrink-0 rounded-full border-[6px] border-white/5 flex flex-col items-center justify-center bg-gradient-to-b from-white/5 to-transparent shadow-[inset_0_-40px_80px_rgba(0,0,0,0.8)]">
          <AnimatePresence>
            {isTracking && (
              <motion.div 
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 rounded-full border-[6px] border-emerald-400/20"
                style={{ clipPath: 'polygon(0 0, 100% 0, 100% 50%, 0 50%)' }}
              />
            )}
          </AnimatePresence>

          <div className="flex flex-col items-center z-10">
            <motion.span 
              layout
              className="text-7xl sm:text-8xl font-mono font-bold tracking-tighter text-emerald-400 drop-shadow-[0_0_30px_rgba(52,211,153,0.3)]"
            >
              {Math.floor(speed)}
            </motion.span>
            <span className="text-lg sm:text-xl font-medium tracking-widest text-emerald-400/60 uppercase mt-[-5px] sm:mt-[-10px]">
              km/h
            </span>

            {/* Indicador Parado/Movimento */}
            <div className="h-8 mt-2 sm:mt-4 overflow-hidden flex items-center justify-center">
              <AnimatePresence mode="popLayout">
                {isTracking && (
                  <motion.div
                    key={isStopped ? 'parado' : 'movendo'}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{ duration: 0.3 }}
                    className={`px-3 py-1.5 rounded-full text-[10px] sm:text-xs font-bold tracking-wider uppercase border flex items-center gap-2 ${ 
                      isStopped 
                        ? 'bg-amber-500/10 text-amber-500 border-amber-500/20' 
                        : 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isStopped ? 'bg-amber-500 animate-pulse' : 'bg-emerald-400'}`} />
                    {isStopped ? 'Parado' : 'Em Movimento'}
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </div>

        {/* Distance Display */}
        <div className="flex flex-col items-center">
          <span className="text-xs sm:text-sm font-medium text-white/40 uppercase tracking-widest mb-1">
            Distância Percorrida
          </span>
          <span className="text-3xl sm:text-4xl font-mono font-bold text-white tracking-tight">
            {formatDistance(distance)}
          </span>
        </div>

        {/* Real-time Metrics Grid */}
        <div className="w-full grid grid-cols-2 gap-3 sm:gap-4">
          <div className="bg-white/5 rounded-2xl p-5 flex flex-col gap-2 border border-white/5">
            <div className="flex items-center gap-2 text-white/40">
              <Clock className="w-4 h-4" />
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-widest">Viagem</span>
            </div>
            <span className="text-2xl sm:text-3xl font-mono font-bold">
              {getEstimatedTravelTime(distance / 1000)}
            </span>
          </div>
          
          <div className="bg-white/5 rounded-2xl p-5 flex flex-col gap-2 border border-white/5">
            <div className="flex items-center gap-2 text-white/40">
              <BatteryMedium className="w-4 h-4" />
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-widest">Bateria Usada</span>
            </div>
            <span className="text-2xl sm:text-3xl font-mono font-bold">
              {getBatteryPercentageConsumed(distance / 1000)}%
            </span>
          </div>

          <div className="bg-amber-500/10 rounded-2xl p-5 flex flex-col gap-2 border border-amber-500/20">
            <div className="flex items-center gap-2 text-amber-400">
              <Coins className="w-4 h-4 text-amber-400" />
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-widest">Custo</span>
            </div>
            <span className="text-2xl sm:text-3xl font-mono font-bold text-amber-400">
              R$ {getTravelCost(distance / 1000)}
            </span>
          </div>

          <div className="bg-emerald-500/10 rounded-2xl p-5 flex flex-col gap-2 border border-emerald-500/20">
            <div className="flex items-center gap-2 text-emerald-400">
              <Zap className="w-4 h-4" />
              <span className="text-[10px] sm:text-xs font-semibold uppercase tracking-widest">Recarga</span>
            </div>
            <span className="text-2xl sm:text-3xl font-mono font-bold text-emerald-400">
              {getRechargeTime(distance / 1000)}
            </span>
          </div>
        </div>

        {/* Error Message */}
        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="flex items-start gap-3 p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 max-w-sm text-center text-sm"
            >
              <AlertCircle className="w-5 h-5 shrink-0" />
              <p className="text-left leading-relaxed">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </main>

      {/* Controls */}
      <footer className="w-full max-w-sm pb-4 sm:pb-8 z-10">
        {!isTracking ? (
          <button
            onClick={startTracking}
            className="w-full flex items-center justify-center gap-3 bg-emerald-500 hover:bg-emerald-400 text-black text-lg font-bold py-5 rounded-3xl transition-transform active:scale-[0.98] shadow-lg shadow-emerald-500/20"
          >
            <Play className="w-6 h-6 fill-current" />
            INICIAR MEDIÇÃO
          </button>
        ) : (
          <button
            onClick={stopTracking}
            className="w-full flex items-center justify-center gap-3 bg-red-500/10 hover:bg-red-500/20 border-2 border-red-500 text-red-500 text-lg font-bold py-4 rounded-3xl transition-transform active:scale-[0.98]"
          >
            <Square className="w-6 h-6 fill-current" />
            PARAR
          </button>
        )}
      </footer>

      {/* Report Overlay */}
      <AnimatePresence>
        {showReport && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            className="fixed inset-0 z-50 bg-black/95 backdrop-blur-xl flex flex-col items-center justify-center p-4 sm:p-6 selection:bg-emerald-500/30 overflow-y-auto"
          >
            <div className="w-full max-w-sm flex flex-col items-center gap-6 sm:gap-8 min-h-min py-8">
              <div className="flex flex-col items-center text-center gap-1 sm:gap-2">
                <div className="w-12 h-12 sm:w-16 sm:h-16 bg-emerald-500/20 rounded-full flex items-center justify-center mb-1 sm:mb-2 shrink-0">
                  <MapPin className="w-6 h-6 sm:w-8 sm:h-8 text-emerald-400" />
                </div>
                <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-white">Resumo da Viagem</h2>
                <p className="text-white/50 text-xs sm:text-sm">Medição finalizada com sucesso</p>
              </div>

              <div className="w-full bg-white/5 border border-white/10 rounded-3xl p-5 sm:p-6 flex flex-col gap-5 sm:gap-6 shrink-0">
                
                <div className="flex flex-col items-center pb-5 sm:pb-6 border-b border-white/5">
                  <span className="text-[10px] sm:text-xs font-semibold text-white/40 uppercase tracking-widest mb-1">
                    Distância Total
                  </span>
                  <span className="text-4xl sm:text-5xl font-mono font-bold text-white tracking-tight">
                    {formatDistance(distance)}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-y-5 sm:gap-y-6 gap-x-4">
                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-white/40">
                      <Clock className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest">Tempo Total</span>
                    </div>
                    <span className="text-xl font-mono font-bold">{getEstimatedTravelTime(distance / 1000)}</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-white/40">
                      <BatteryMedium className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest">Bateria Usada</span>
                    </div>
                    <span className="text-xl font-mono font-bold">{getBatteryPercentageConsumed(distance / 1000)}%</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-amber-400">
                      <Coins className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest">Custo Total</span>
                    </div>
                    <span className="text-xl font-mono font-bold text-amber-400">R$ {getTravelCost(distance / 1000)}</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex items-center gap-2 text-emerald-400">
                      <Zap className="w-3.5 h-3.5" />
                      <span className="text-[10px] font-semibold uppercase tracking-widest">Tempo Recarga</span>
                    </div>
                    <span className="text-xl font-mono font-bold text-emerald-400">{getRechargeTime(distance / 1000)}</span>
                  </div>
                </div>

              </div>

              <button
                onClick={closeReport}
                className="w-full flex items-center justify-center gap-3 bg-emerald-500 hover:bg-emerald-400 text-black text-base sm:text-lg font-bold py-4 sm:py-5 rounded-3xl transition-transform active:scale-[0.98] shadow-lg shadow-emerald-500/20 mt-2 shrink-0"
              >
                NOVA MEDIÇÃO
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
