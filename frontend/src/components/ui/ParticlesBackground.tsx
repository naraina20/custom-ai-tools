'use client';

import React, { useCallback, useEffect, useState } from 'react';
import Particles, { ParticlesProvider } from '@tsparticles/react';
import { loadSlim } from '@tsparticles/slim';
import type { Engine } from '@tsparticles/engine';

export function ParticlesBackground() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const initEngine = useCallback(async (engine: Engine) => {
    await loadSlim(engine);
  }, []);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 pointer-events-none -z-10 overflow-hidden opacity-60">
      <ParticlesProvider init={initEngine}>
        <Particles
          id="tsparticles"
          className="w-full h-full"
          options={{
            background: { color: { value: 'transparent' } },
            fpsLimit: 60,
            particles: {
              color: { value: ['#6366f1', '#a855f7', '#38bdf8'] },
              links: {
                color: '#6366f1',
                distance: 130,
                enable: true,
                opacity: 0.12,
                width: 1,
              },
              move: {
                enable: true,
                speed: 0.6,
                direction: 'none',
                random: false,
                straight: false,
                outModes: { default: 'out' },
              },
              number: {
                density: { enable: true, width: 1200, height: 800 },
                value: 32,
              },
              opacity: { value: { min: 0.1, max: 0.35 } },
              shape: { type: 'circle' },
              size: { value: { min: 1, max: 2.5 } },
            },
            interactivity: {
              events: {
                onHover: { enable: false, mode: 'grab' },
              },
            },
            detectRetina: true,
          }}
        />
      </ParticlesProvider>
    </div>
  );
}
