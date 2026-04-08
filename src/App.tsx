import { useEffect, useRef, useState } from 'react';
import { Play, RotateCcw, Pause, Timer as TimerIcon } from 'lucide-react';
import { initPhysics, PhysicsEngine } from './physics';
import { motion, AnimatePresence } from 'motion/react';

export default function App() {
  const canvasRef = useRef<HTMLDivElement>(null);
  const physicsRef = useRef<PhysicsEngine | null>(null);
  const [timeLeft, setTimeLeft] = useState(120); // Default to 2:00
  const [isActive, setIsActive] = useState(false);
  const [initialTime, setInitialTime] = useState(120);
  const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });
  const spawnedCountRef = useRef(0);
  const timeLeftRef = useRef(timeLeft);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('02:00');
  const [zoomScale, setZoomScale] = useState(1);
  const [chipsMode, setChipsMode] = useState(false);

  // Preload chip image
  useEffect(() => {
    const img = new Image();
    img.src = 'https://res.cloudinary.com/dtw8jfk0k/image/upload/v1774685343/single-potato-chips-isolated-white-background-with-clipping-path_271326-1147_redigeret_nlrovn.png';
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      if (physicsRef.current && canvasRef.current) {
        const highestY = physicsRef.current.getHighestParticleY();
        const containerHeight = canvasRef.current.clientHeight;
        const zoomStartThreshold = containerHeight * 0.25; // Start zooming when pile reaches top 25%
        
        let targetScale = 1;
        if (highestY < zoomStartThreshold) {
          // Calculate progress into the zoom zone
          const zoomProgress = (zoomStartThreshold - highestY) / (zoomStartThreshold + containerHeight * 0.1);
          targetScale = 1 - (zoomProgress * 0.45); // Zoom out less aggressively
          targetScale = Math.max(0.55, targetScale); // Minimum scale is now 0.55 instead of 0.4
        }
        
        setZoomScale(prev => {
          // Much slower interpolation for buttery smooth movement
          const next = prev + (targetScale - prev) * 0.03;
          
          // Only update if the change is significant to avoid jitter
          if (Math.abs(next - prev) > 0.0001) {
            physicsRef.current?.updateZoom(next);
            return next;
          }
          return prev;
        });
      }
    }, 30);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (canvasRef.current && !physicsRef.current) {
      physicsRef.current = initPhysics(canvasRef.current);
      physicsRef.current.setChipsMode(chipsMode);
    }

    const handleResize = () => {
      if (physicsRef.current && canvasRef.current) {
        const oldWidth = physicsRef.current.getWidth();
        const particles = physicsRef.current.getParticles();
        const spawnedCount = physicsRef.current.getSpawnedCount();
        const wasHatchOpen = physicsRef.current.isHatchOpen();
        
        physicsRef.current.destroy();
        physicsRef.current = initPhysics(canvasRef.current, spawnedCount);
        physicsRef.current.setChipsMode(chipsMode);
        
        const newWidth = canvasRef.current.clientWidth;
        const shiftX = (newWidth - oldWidth) / 2;
        
        physicsRef.current.addParticles(particles, shiftX);
        
        if (wasHatchOpen) {
          physicsRef.current.removeHatch();
        }
        
        setWindowSize({ width: newWidth, height: canvasRef.current.clientHeight });
      }
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (physicsRef.current) {
        physicsRef.current.destroy();
        physicsRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    let timer: NodeJS.Timeout;
    if (isActive && timeLeft > 0) {
      timer = setInterval(() => {
        setTimeLeft((prev) => prev - 1);
      }, 1000);
    } else if (timeLeft === 0 && isActive) {
      setIsActive(false);
      physicsRef.current?.removeHatch();
    }
    return () => clearInterval(timer);
  }, [isActive, timeLeft]);

  useEffect(() => {
    timeLeftRef.current = timeLeft;
  }, [timeLeft]);

  const handleStart = () => {
    if (timeLeft === 0) return;
    setIsActive(true);
    setIsEditing(false);
  };

  const handlePause = () => {
    setIsActive(false);
  };

  const handleReset = () => {
    setIsActive(false);
    setTimeLeft(initialTime);
    setEditValue(formatTime(initialTime));
    spawnedCountRef.current = 0;
    physicsRef.current?.resetHatch();
    physicsRef.current?.clearParticles();
  };

  const toggleChipsMode = () => {
    const next = !chipsMode;
    setChipsMode(next);
    physicsRef.current?.setChipsMode(next);
  };

  const adjustTime = (amount: number) => {
    const newTime = Math.max(0, (isActive ? timeLeft : initialTime) + amount);
    if (isActive) {
      setTimeLeft(newTime);
    } else {
      setInitialTime(newTime);
      setTimeLeft(newTime);
      setEditValue(formatTime(newTime));
    }
  };

  // Dynamic spawn rate: adjusts based on current timeLeft and window size
  useEffect(() => {
    let timeoutId: NodeJS.Timeout | null = null;

    if (isActive && timeLeftRef.current > 0) {
      const spawn = () => {
        if (!physicsRef.current) return;

        // Calculate target total based on canvas area
        const width = physicsRef.current.getWidth();
        const height = physicsRef.current.getHeight();
        const area = width * height;
        const baseArea = 1200 * 800;
        
        // Scale targetTotal with area to adapt to window size
        let targetTotal = Math.max(600, Math.floor((area / baseArea) * 1200));
        
        if (chipsMode) {
          targetTotal = Math.max(80, Math.floor(targetTotal * 0.15));
        }
        
        const cappedTargetTotal = Math.min(3500, targetTotal);
        const remainingToSpawn = Math.max(1, cappedTargetTotal - spawnedCountRef.current);
        
        // Calculate how much time we have until we should be 100% full (at 5% time left)
        const targetTimeLeft = initialTime * 0.05;
        const timeUntilFull = Math.max(0.1, timeLeftRef.current - targetTimeLeft);
        
        // Calculate interval to reach target exactly at the 95% mark (5% left)
        const interval = (timeUntilFull * 1000) / remainingToSpawn;
        const clampedInterval = Math.min(2000, Math.max(10, interval));
        const overflowInterval = chipsMode ? 250 : 80;

        if (spawnedCountRef.current < cappedTargetTotal) {
          physicsRef.current.spawnParticle();
          spawnedCountRef.current++;
          timeoutId = setTimeout(spawn, clampedInterval);
        } else {
          // Overflow mode
          if (Math.random() > 0.5) {
            physicsRef.current.spawnParticle();
          }
          timeoutId = setTimeout(spawn, overflowInterval);
        }
      };

      // Start spawning immediately
      spawn();
    }

    return () => {
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isActive, chipsMode, initialTime, windowSize]);

  const handleTimeSubmit = () => {
    const parts = editValue.split(':');
    let totalSeconds = 0;
    if (parts.length === 2) {
      totalSeconds = parseInt(parts[0]) * 60 + parseInt(parts[1]);
    } else {
      totalSeconds = parseInt(editValue);
    }
    
    if (!isNaN(totalSeconds)) {
      const finalSeconds = Math.max(0, totalSeconds);
      setInitialTime(finalSeconds);
      setTimeLeft(finalSeconds);
      setEditValue(formatTime(finalSeconds));
    }
    setIsEditing(false);
  };

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex h-screen w-screen bg-white overflow-hidden">
      {/* Sidebar */}
      <div className="w-64 h-[calc(100%-2rem)] m-4 bg-[#F3E0EB] rounded-[2rem] flex flex-col items-center p-6 gap-4 shadow-sm relative">
        
        {/* Timer Display */}
        <div className="w-full bg-white rounded-2xl py-4 flex items-center justify-center shadow-sm cursor-pointer">
          {isEditing && !isActive ? (
            <input
              autoFocus
              className="text-4xl font-bold text-[#141414] w-full text-center outline-none"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleTimeSubmit}
              onKeyDown={(e) => e.key === 'Enter' && handleTimeSubmit()}
            />
          ) : (
            <span 
              className="text-4xl font-bold text-[#141414]"
              onClick={() => !isActive && setIsEditing(true)}
            >
              {formatTime(timeLeft)}
            </span>
          )}
        </div>

        {/* Adjust Buttons */}
        <div className="flex w-full gap-3">
          <button 
            onClick={() => adjustTime(-60)}
            className="flex-1 bg-white rounded-xl py-3 font-bold text-xl shadow-sm hover:bg-gray-50 transition-colors"
          >
            -1
          </button>
          <button 
            onClick={() => adjustTime(60)}
            className="flex-1 bg-white rounded-xl py-3 font-bold text-xl shadow-sm hover:bg-gray-50 transition-colors"
          >
            +1
          </button>
        </div>

        {/* Action Buttons */}
        <div className="w-full flex flex-col gap-3 mt-2">
          {isActive ? (
            <button 
              onClick={handlePause}
              className="w-full bg-[#151628] text-white rounded-xl py-4 font-bold text-lg shadow-md hover:bg-[#1f213a] transition-colors"
            >
              Pause
            </button>
          ) : (
            <button 
              onClick={handleStart}
              disabled={timeLeft === 0}
              className="w-full bg-[#151628] text-white rounded-xl py-4 font-bold text-lg shadow-md hover:bg-[#1f213a] transition-colors disabled:opacity-50"
            >
              Start
            </button>
          )}

          <button 
            onClick={handleReset}
            className="w-full bg-white text-[#141414] rounded-xl py-4 font-bold text-lg shadow-sm hover:bg-gray-50 transition-colors"
          >
            Nulstil
          </button>

          {/* Chips-mode Switch */}
          <div className="w-full flex items-center justify-center gap-3 px-2 -mt-1">
            <span className="text-sm font-medium text-[#141414]/60">Chips-mode</span>
            <button
              onClick={toggleChipsMode}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none ${
                chipsMode ? 'bg-[#fbbf24]' : 'bg-gray-400'
              }`}
            >
              <span
                className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                  chipsMode ? 'translate-x-5' : 'translate-x-1'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Footer Logo */}
        <a 
          href="https://skolechips.dk" 
          className="mt-auto flex justify-center pb-4 hover:opacity-80 transition-opacity cursor-pointer w-full"
        >
          <img 
            src="https://res.cloudinary.com/dtw8jfk0k/image/upload/v1774287946/ikon_m2x8mj.png" 
            alt="Logo" 
            className="w-32 h-32 object-contain"
            referrerPolicy="no-referrer"
          />
        </a>
      </div>

      {/* Main Physics Area */}
      <div className="flex-1 h-full relative overflow-hidden">
        <div 
          ref={canvasRef} 
          className="w-full h-full"
          id="physics-container"
        />
      </div>
    </div>
  );
}
