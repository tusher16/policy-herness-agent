import React from 'react';
import { SimulationStep, PresetScenario } from '../types';

interface ArchitectureDiagramProps {
  currentStep: SimulationStep;
  activeScenario: PresetScenario | null;
  onBlockClick: (blockName: string) => void;
  activeBlock: string | null;
  simulationProgress: number; // 0 to 100 representing state progression
}

export const ArchitectureDiagram: React.FC<ArchitectureDiagramProps> = ({
  currentStep,
  activeScenario,
  onBlockClick,
  activeBlock,
  simulationProgress,
}) => {
  // Determine highlights for specific blocks
  const isInputGuardActive = currentStep === 'INPUT_GUARD';
  const isRejectedActive = currentStep === 'REJECTED_STATE';
  const isObserveActive = currentStep === 'OBSERVE';
  const isReasonActive = currentStep === 'REASON';
  const isFeedbackActive = currentStep === 'FEEDBACK_LOOP';
  const isActActive = currentStep === 'ACT';
  const isOutputGuardActive = currentStep === 'OUTPUT_GUARD';
  const isAlertActive = currentStep === 'ALERT_STATE';

  // Helper to check if block is selected/active
  const getBlockClasses = (blockName: string, isStageActive: boolean, colorClass: string) => {
    const isClicked = activeBlock === blockName;
    return `cursor-pointer transition-all duration-300 ${
      isStageActive 
        ? `${colorClass} filter drop-shadow-[0_0_8px_rgba(22,163,74,0.3)] stroke-2` 
        : isClicked
        ? 'stroke-[#16a34a] stroke-1.5'
        : 'hover:stroke-gray-400 stroke-1'
    }`;
  };

  // Dynamic progress values for SVG progress bars
  const searchProgressW = isObserveActive || isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 50 : simulationProgress > 20 && currentStep === 'OBSERVE' ? 36 : 10;
  const pageProgressW = isObserveActive || isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 38 : simulationProgress > 40 && currentStep === 'OBSERVE' ? 20 : 5;
  const parseProgressW = isObserveActive || isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 50 : simulationProgress > 70 && currentStep === 'OBSERVE' ? 30 : 8;

  const diffProgressW = isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 45 : simulationProgress > 30 && currentStep === 'REASON' ? 20 : 8;
  const rankProgressW = isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 40 : simulationProgress > 60 && currentStep === 'REASON' ? 16 : 6;
  const confProgressW = isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 50 : simulationProgress > 80 && currentStep === 'REASON' ? 25 : 10;

  const sumProgressW = isActActive || isOutputGuardActive || isAlertActive
    ? 46 : simulationProgress > 40 && currentStep === 'ACT' ? 25 : 5;
  const notifyProgressW = isActActive || isOutputGuardActive || isAlertActive
    ? 40 : simulationProgress > 70 && currentStep === 'ACT' ? 20 : 5;
  const tokenProgressW = isActActive || isOutputGuardActive || isAlertActive
    ? 50 : simulationProgress > 90 && currentStep === 'ACT' ? 30 : 6;

  // Confidence displays
  const displayedConfidence = activeScenario?.behaviorType === 'low_confidence' && isFeedbackActive
    ? '0.42 (low)' 
    : activeScenario ? activeScenario.reasonResults.confidence.toFixed(2) : '0.95';

  return (
    <div className="w-full h-full relative" id="pulse-arch-view">
      <svg
        viewBox="0 0 1200 568"
        className="w-full h-full text-slate-700 bg-[#eef1ec]"
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <marker id="a" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M2 1L8 5L2 9" fill="none" stroke="#b0b8ac" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </marker>
          <marker id="ag" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M2 1L8 5L2 9" fill="none" stroke="#16a34a" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </marker>
          <marker id="ar" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M2 1L8 5L2 9" fill="none" stroke="#ef4444" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </marker>
          <marker id="ao" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto">
            <path d="M2 1L8 5L2 9" fill="none" stroke="#f97316" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
          </marker>
          
          {/* Neon/Pulse Gradients */}
          <linearGradient id="selectedGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#22c55e" stopOpacity="0.2"/>
            <stop offset="100%" stopColor="#15803d" stopOpacity="0.05"/>
          </linearGradient>
          <linearGradient id="rejectGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#ef4444" stopOpacity="0.15"/>
            <stop offset="100%" stopColor="#b91c1c" stopOpacity="0.02"/>
          </linearGradient>
          <linearGradient id="observeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#10b981" stopOpacity="0.1"/>
            <stop offset="100%" stopColor="#047857" stopOpacity="0.01"/>
          </linearGradient>
        </defs>

        {/* ── PROMPT BOX ─────────────────────────────────────────── */}
        <g 
          onClick={() => onBlockClick('PROMPT')}
          className={`group transition-all duration-300 transform`}
        >
          <rect 
            x="24" 
            y="180" 
            width="110" 
            height="86" 
            rx="7" 
            fill="#fff" 
            stroke={currentStep === 'IDLE' ? '#16a34a' : activeBlock === 'PROMPT' ? '#22c55e' : '#e2e6df'} 
            strokeWidth={currentStep === 'IDLE' ? '1.8' : '1'}
            className="transition-all duration-300"
          />
          <circle cx="36" cy="202" r="4.5" fill="#d1d5db" />
          <text 
            x="49" 
            y="206" 
            fontFamily="'Space Mono', monospace" 
            fontSize="12.5" 
            fontWeight="700" 
            fill="#374151" 
            letterSpacing=".06em"
          >
            PROMPT
          </text>
          <text x="36" y="226" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#9ca3af">
            human intent
          </text>
          <text 
            x="36" 
            y="246" 
            fontFamily="'IBM Plex Sans', sans-serif" 
            fontSize="10" 
            fill="#16a34a" 
            fontWeight={activeScenario ? 'bold' : 'normal'}
            fontStyle="italic"
            className="transition-all duration-300 truncate"
          >
            {activeScenario ? activeScenario.category : 'USA student visa'}
          </text>
        </g>

        {/* Topic → Input Guard Connection */}
        <line 
          x1="134" 
          y1="228" 
          x2="156" 
          y2="228" 
          stroke={isInputGuardActive ? '#16a34a' : '#b0b8ac'} 
          strokeWidth={isInputGuardActive ? '1.5' : '.8'} 
          markerEnd={isInputGuardActive ? 'url(#ag)' : 'url(#a)'}
          className="transition-colors duration-300"
        />

        {/* ── INPUT GUARDRAIL ──────────────────────────────────────── */}
        <g 
          onClick={() => onBlockClick('INPUT GUARDRAIL')}
          className={getBlockClasses('INPUT GUARDRAIL', isInputGuardActive, 'stroke-orange-500')}
        >
          <rect 
            x="158" 
            y="150" 
            width="134" 
            height="156" 
            rx="7" 
            fill={isInputGuardActive ? 'url(#selectedGrad)' : '#fff'} 
            stroke={isInputGuardActive ? '#f97316' : activeBlock === 'INPUT GUARDRAIL' ? '#16a34a' : '#e2e6df'} 
            strokeWidth={isInputGuardActive ? '1.5' : '.8'}
          />
          <circle cx="172" cy="172" r="4.5" fill="#f97316"/>
          <text x="185" y="176" fontFamily="'Space Mono', monospace" fontSize="12" fontWeight="700" fill="#374151" letterSpacing=".06em">INPUT</text>
          <text x="185" y="192" fontFamily="'Space Mono', monospace" fontSize="12" fontWeight="700" fill="#374151" letterSpacing=".06em">GUARDRAIL</text>
          <text x="172" y="210" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#9ca3af">topic · injection check</text>
          
          <g>
            <rect x="172" y="220" width="32" height="15" rx="2.5" fill="#f1f5f9"/>
            <text x="188" y="231" fontFamily="'Space Mono', monospace" fontSize="9" fontWeight="700" fill="#475569" textAnchor="middle" letterSpacing=".04em">CPU</text>
            
            <rect x="210" y="220" width="32" height="15" rx="2.5" fill={isInputGuardActive ? '#bbf7d0' : '#f0fdf4'}/>
            <text x="226" y="231" fontFamily="'Space Mono', monospace" fontSize="9" fontWeight="700" fill="#15803d" textAnchor="middle" letterSpacing=".04em">DPU</text>
          </g>
          
          <line x1="172" y1="242" x2="278" y2="242" stroke="#f3f4f0" strokeWidth=".6"/>
          
          <text 
            x="172" 
            y="256" 
            fontFamily="'IBM Plex Sans', sans-serif" 
            fontSize="10" 
            fill={activeScenario?.behaviorType === 'injection' && currentStep !== 'IDLE' ? '#ef4444' : '#16a34a'}
            fontWeight={activeScenario?.behaviorType === 'injection' ? '500' : 'normal'}
          >
            {activeScenario?.behaviorType === 'injection' && currentStep !== 'IDLE' ? '✓ query loaded' : '✓ approved topics'}
          </text>
          <text 
            x="172" 
            y="272" 
            fontFamily="'IBM Plex Sans', sans-serif" 
            fontSize="10" 
            fill={activeScenario?.behaviorType === 'injection' && currentStep !== 'IDLE' ? '#ef4444' : '#16a34a'}
            fontWeight={activeScenario?.behaviorType === 'injection' ? '600' : 'normal'}
          >
            {activeScenario?.behaviorType === 'injection' && currentStep !== 'IDLE' ? '✗ injection attack!' : '✓ prompt injection'}
          </text>
          <text 
            x="172" 
            y="288" 
            fontFamily="'IBM Plex Sans', sans-serif" 
            fontSize="10" 
            fill="#16a34a"
          >
            ✓ length limits
          </text>
        </g>

        {/* Input Guard Approved → Harness Flow */}
        <text x="305" y="219" fontFamily="'IBM Plex Sans', sans-serif" fontSize="11" fill={currentStep !== 'IDLE' && currentStep !== 'INPUT_GUARD' && currentStep !== 'REJECTED_STATE' ? '#16a34a' : '#a0a89c'} textAnchor="middle" fontWeight="500" letterSpacing=".02em">ok</text>
        <line 
          x1="292" 
          y1="228" 
          x2="316" 
          y2="228" 
          stroke={currentStep !== 'IDLE' && currentStep !== 'INPUT_GUARD' && currentStep !== 'REJECTED_STATE' ? '#16a34a' : '#b0b8ac'} 
          strokeWidth={currentStep !== 'IDLE' && currentStep !== 'INPUT_GUARD' && currentStep !== 'REJECTED_STATE' ? '1.5' : '.8'} 
          markerEnd={currentStep !== 'IDLE' && currentStep !== 'INPUT_GUARD' && currentStep !== 'REJECTED_STATE' ? 'url(#ag)' : 'url(#a)'}
        />

        {/* Input Guard Blocked ↓ Reject Flow */}
        <text 
          x="195" 
          y="346" 
          fontFamily="'IBM Plex Sans', sans-serif" 
          fontSize="10.5" 
          fill={isRejectedActive ? '#ef4444' : '#a0a89c'} 
          textAnchor="middle"
          fontWeight={isRejectedActive ? '600' : 'normal'}
        >
          blocked
        </text>
        <line 
          x1="225" 
          y1="306" 
          x2="225" 
          y2="378" 
          stroke={isRejectedActive ? '#ef4444' : '#b0b8ac'} 
          strokeWidth={isRejectedActive ? '1.5' : '.8'} 
          strokeDasharray="4 3" 
          markerEnd={isRejectedActive ? 'url(#ar)' : 'url(#a)'}
        />

        {/* ── HARNESS CONTAINER ──────────────────────────────── */}
        <rect 
          x="318" 
          y="130" 
          width="570" 
          height="180" 
          rx="9" 
          fill="rgba(255,255,255,.38)" 
          stroke={isObserveActive || isReasonActive || isActActive || isFeedbackActive ? '#16a34a' : '#b8c0b4'} 
          strokeWidth={isObserveActive || isReasonActive || isActActive || isFeedbackActive ? '1.8' : '1.2'} 
          strokeDasharray={isObserveActive || isReasonActive || isActActive || isFeedbackActive ? 'none' : '5 4'}
          className="transition-all duration-300"
        />
        {/* floating harness label */}
        <rect x="334" y="122" width="280" height="16" fill="#eef1ec" />
        <text x="342" y="134" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#a0a89c" fontWeight="600" letterSpacing=".04em">agent harness  ·  observe → reason → act</text>

        {/* ── OBSERVE BLOCK ────────────────────────────────────────────────── */}
        <g 
          onClick={() => onBlockClick('OBSERVE')}
          className={getBlockClasses('OBSERVE', isObserveActive, 'stroke-emerald-500')}
        >
          <rect 
            x="332" 
            y="146" 
            width="172" 
            height="150" 
            rx="7" 
            fill={isObserveActive ? 'url(#observeGrad)' : '#fff'} 
            stroke={isObserveActive ? '#16a34a' : activeBlock === 'OBSERVE' ? '#16a34a' : '#e2e6df'} 
            strokeWidth={isObserveActive ? '1.5' : '.8'}
          />
          <rect x="332" y="146" width="3" height="150" rx="1.5" fill="#16a34a"/>
          <circle cx="348" cy="168" r="4.5" fill="#16a34a" />
          <text x="361" y="173" fontFamily="'Space Mono', monospace" fontSize="13.5" fontWeight="700" fill="#111" letterSpacing=".05em">OBSERVE</text>
          <text x="348" y="192" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#9ca3af">official source search</text>
          
          <rect x="348" y="202" width="28" height="14" rx="2.5" fill="#dbeafe"/>
          <text x="362" y="212" fontFamily="'Space Mono', monospace" fontSize="9" fontWeight="700" fill="#1d4ed8" textAnchor="middle" letterSpacing=".04em">LLM</text>
          
          {/* Dynamic Observe status rows & progress meters */}
          <text x="348" y="234" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#a0a89c">web_search</text>
          <rect x="440" y="225" width="50" height="10" rx="2.5" fill="#f3f4f0"/>
          <rect x="440" y="225" width={searchProgressW} height="10" rx="2.5" fill="#10b981" className="transition-all duration-500"/>
          
          <text x="348" y="254" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#a0a89c">page_fetcher</text>
          <rect x="440" y="245" width="50" height="10" rx="2.5" fill="#f3f4f0"/>
          <rect x="440" y="245" width={pageProgressW} height="10" rx="2.5" fill="#34d399" className="transition-all duration-500"/>
          
          <text x="348" y="278" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#16a34a" fontWeight="600">
            {activeScenario ? `${activeScenario.observeResults.sources.length} sources found` : '6 sources found'}
          </text>
          <rect x="440" y="270" width="50" height="10" rx="2.5" fill="#f3f4f0"/>
          <rect x="440" y="270" width={parseProgressW} height="10" rx="2.5" fill="#047857" className="transition-all duration-500"/>
        </g>

        {/* OBSERVE → REASON Flow Arrow */}
        <line 
          x1="504" 
          y1="221" 
          x2="518" 
          y2="221" 
          stroke={isObserveActive || isReasonActive ? '#16a34a' : '#b0b8ac'} 
          strokeWidth={isObserveActive || isReasonActive ? '1.5' : '.8'} 
          markerEnd={isObserveActive || isReasonActive ? 'url(#ag)' : 'url(#a)'}
        />

        {/* ── REASON BLOCK ─────────────────────────────────────────────────── */}
        <g 
          onClick={() => onBlockClick('REASON')}
          className={getBlockClasses('REASON', isReasonActive, 'stroke-emerald-500')}
        >
          <rect 
            x="518" 
            y="146" 
            width="172" 
            height="150" 
            rx="7" 
            fill={isReasonActive ? 'url(#observeGrad)' : '#fff'} 
            stroke={isReasonActive ? '#16a34a' : activeBlock === 'REASON' ? '#16a34a' : '#e2e6df'} 
            strokeWidth={isReasonActive ? '1.5' : '.8'}
          />
          <rect x="518" y="146" width="3" height="150" rx="1.5" fill="#16a34a"/>
          <circle cx="534" cy="168" r="4.5" fill="#16a34a" />
          <text x="547" y="173" fontFamily="'Space Mono', monospace" fontSize="13.5" fontWeight="700" fill="#111" letterSpacing=".05em">REASON</text>
          <text x="534" y="192" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#9ca3af">policy analysis</text>
          
          <rect x="534" y="202" width="28" height="14" rx="2.5" fill="#dbeafe"/>
          <text x="548" y="212" fontFamily="'Space Mono', monospace" fontSize="9" fontWeight="700" fill="#1d4ed8" textAnchor="middle" letterSpacing=".04em">LLM</text>
          
          <text x="534" y="234" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#a0a89c">diff_engine</text>
          <rect x="626" y="225" width="50" height="10" rx="2.5" fill="#f3f4f0"/>
          <rect x="626" y="225" width={diffProgressW} height="10" rx="2.5" fill="#10b981" className="transition-all duration-500"/>
          
          <text x="534" y="254" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#a0a89c">source ranking</text>
          <rect x="626" y="245" width="50" height="10" rx="2.5" fill="#f3f4f0"/>
          <rect x="626" y="245" width={rankProgressW} height="10" rx="2.5" fill="#34d399" className="transition-all duration-500"/>
          
          <text x="534" y="278" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#16a34a" fontWeight="600">
            conf: {displayedConfidence}
          </text>
          <rect x="626" y="270" width="50" height="10" rx="2.5" fill="#f3f4f0"/>
          <rect 
            x="626" y="270" 
            width={activeScenario?.behaviorType === 'low_confidence' && isFeedbackActive ? 22 : confProgressW} 
            height="10" rx="2.5" 
            fill={activeScenario?.behaviorType === 'low_confidence' && isFeedbackActive ? '#f97316' : '#047857'} 
            className="transition-all duration-500"
          />
        </g>

        {/* REASON → ACT Flow Arrow */}
        <line 
          x1="690" 
          y1="221" 
          x2="704" 
          y2="221" 
          stroke={isReasonActive || isActActive ? '#16a34a' : '#b0b8ac'} 
          strokeWidth={isReasonActive || isActActive ? '1.5' : '.8'} 
          markerEnd={isReasonActive || isActActive ? 'url(#ag)' : 'url(#a)'}
        />

        {/* ── ACT BLOCK ───────────────────────────────────────────────────── */}
        <g 
          onClick={() => onBlockClick('ACT')}
          className={getBlockClasses('ACT', isActActive, 'stroke-emerald-500')}
        >
          <rect 
            x="704" 
            y="146" 
            width="172" 
            height="150" 
            rx="7" 
            fill={isActActive ? 'url(#observeGrad)' : '#fff'} 
            stroke={isActActive ? '#16a34a' : activeBlock === 'ACT' ? '#16a34a' : '#e2e6df'} 
            strokeWidth={isActActive ? '1.5' : '.8'}
          />
          <rect x="704" y="146" width="3" height="150" rx="1.5" fill="#16a34a"/>
          <circle cx="720" cy="168" r="4.5" fill="#16a34a" />
          <text x="733" y="173" fontFamily="'Space Mono', monospace" fontSize="13.5" fontWeight="700" fill="#111" letterSpacing=".05em">ACT</text>
          <text x="720" y="192" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#9ca3af">actionable alert</text>
          
          <rect x="720" y="202" width="28" height="14" rx="2.5" fill="#dbeafe"/>
          <text x="734" y="212" fontFamily="'Space Mono', monospace" fontSize="9" fontWeight="700" fill="#1d4ed8" textAnchor="middle" letterSpacing=".04em">LLM</text>
          
          <text x="720" y="234" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#a0a89c">summarizer</text>
          <rect x="812" y="225" width="50" height="10" rx="2.5" fill="#f3f4f0"/>
          <rect x="812" y="225" width={sumProgressW} height="10" rx="2.5" fill="#10b981" className="transition-all duration-500"/>
          
          <text x="720" y="254" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#a0a89c">notifier</text>
          <rect x="812" y="245" width="50" height="10" rx="2.5" fill="#f3f4f0"/>
          <rect x="812" y="245" width={notifyProgressW} height="10" rx="2.5" fill="#34d399" className="transition-all duration-500"/>
          
          <text x="720" y="278" fontFamily="'IBM Plex Sans', sans-serif" fontSize="9.5" fill="#16a34a" fontWeight="600">
            {activeScenario ? `${activeScenario.actResults.tokensUsed} tok · $${activeScenario.actResults.costUsd.toFixed(5)}` : '2100 tok · $0.00004'}
          </text>
          <rect x="812" y="270" width="50" height="10" rx="2.5" fill="#f3f4f0"/>
          <rect x="812" y="270" width={tokenProgressW} height="10" rx="2.5" fill="#047857" className="transition-all duration-500"/>
        </g>

        {/* ── FEEDBACK ARC (REASON → OBSERVE when low confidence) ────── */}
        <g className="transition-opacity duration-300">
          <path 
            d="M604,296 L604,334 L418,334 L418,296" 
            fill="none" 
            stroke={isFeedbackActive ? '#f97316' : '#b0b8ac'} 
            strokeWidth={isFeedbackActive ? '1.8' : '.8'} 
            strokeDasharray={isFeedbackActive ? 'none' : '4 3'} 
            markerEnd={isFeedbackActive ? 'url(#ao)' : 'url(#a)'}
            className="transition-all duration-300"
          />
          <rect 
            x="426" 
            y="325" 
            width="170" 
            height="18" 
            rx="3.5" 
            fill={isFeedbackActive ? '#ffedd5' : '#eef1ec'} 
            className="transition-colors duration-300"
          />
          <text 
            x="511" 
            y="337" 
            fontFamily="'IBM Plex Sans', sans-serif" 
            fontSize="9.5" 
            fill={isFeedbackActive ? '#c2410c' : '#9ca3af'} 
            textAnchor="middle" 
            fontStyle="italic"
            fontWeight={isFeedbackActive ? 'bold' : 'normal'}
            className="transition-all duration-300"
          >
            {isFeedbackActive ? '↺ low conf · REcheck triggered!' : '↺ low confidence · re-search'}
          </text>
        </g>

        {/* Harness → Output Guard Connector */}
        <line 
          x1="888" 
          y1="228" 
          x2="910" 
          y2="228" 
          stroke={isOutputGuardActive || isAlertActive ? '#16a34a' : '#b0b8ac'} 
          strokeWidth={isOutputGuardActive || isAlertActive ? '1.5' : '.8'} 
          markerEnd={isOutputGuardActive || isAlertActive ? 'url(#ag)' : 'url(#a)'}
        />

        {/* ── OUTPUT GUARDRAIL ────────────────────────────────────── */}
        <g 
          onClick={() => onBlockClick('OUTPUT GUARDRAIL')}
          className={getBlockClasses('OUTPUT GUARDRAIL', isOutputGuardActive, 'stroke-orange-500')}
        >
          <rect 
            x="912" 
            y="150" 
            width="134" 
            height="156" 
            rx="7" 
            fill={isOutputGuardActive ? 'url(#selectedGrad)' : '#fff'} 
            stroke={isOutputGuardActive ? '#f97316' : activeBlock === 'OUTPUT GUARDRAIL' ? '#16a34a' : '#e2e6df'} 
            strokeWidth={isOutputGuardActive ? '1.5' : '.8'}
          />
          <circle cx="926" cy="172" r="4.5" fill="#f97316"/>
          <text x="939" y="176" fontFamily="'Space Mono', monospace" fontSize="12" fontWeight="700" fill="#374151" letterSpacing=".06em">OUTPUT</text>
          <text x="939" y="192" fontFamily="'Space Mono', monospace" fontSize="12" fontWeight="700" fill="#374151" letterSpacing=".06em">GUARDRAIL</text>
          <text x="926" y="210" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#9ca3af">citation · confidence</text>
          
          <g>
            <rect x="926" y="220" width="32" height="15" rx="2.5" fill="#f1f5f9"/>
            <text x="942" y="231" fontFamily="'Space Mono', monospace" fontSize="9" fontWeight="700" fill="#475569" textAnchor="middle" letterSpacing=".04em">CPU</text>
            
            <rect x="964" y="220" width="32" height="15" rx="2.5" fill="#f0fdf4"/>
            <text x="980" y="231" fontFamily="'Space Mono', monospace" fontSize="9" fontWeight="700" fill="#15803d" textAnchor="middle" letterSpacing=".04em">DPU</text>
          </g>
          
          {/* Output audit checks */}
          <text x="926" y="256" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#16a34a">✓ legal disclaimer</text>
          <text x="926" y="272" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#16a34a">✓ confidence score</text>
          <text x="926" y="288" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#16a34a">✓ source citations</text>
        </g>

        {/* Output Guard Approved → SUCCESS ALERT FLOW */}
        <line 
          x1="1046" 
          y1="228" 
          x2="1064" 
          y2="228" 
          stroke={isAlertActive ? '#16a34a' : '#b0b8ac'} 
          strokeWidth={isAlertActive ? '1.5' : '.8'} 
          markerEnd={isAlertActive ? 'url(#ag)' : 'url(#a)'}
        />

        {/* ── ALERT OUTPUT CARD ─────────────────────────────────────────── */}
        <g 
          onClick={() => onBlockClick('ALERT')}
          className={`cursor-pointer transition-all duration-300 ${isAlertActive ? 'filter drop-shadow-[0_0_12px_rgba(34,197,94,0.45)]' : ''}`}
        >
          <rect 
            x="1066" 
            y="180" 
            width="114" 
            height="86" 
            rx="7" 
            fill={isAlertActive ? '#f0fdf4' : '#fff'} 
            stroke={isAlertActive ? '#16a34a' : activeBlock === 'ALERT' ? '#16a34a' : '#86efac'} 
            strokeWidth={isAlertActive ? '2' : '.8'}
          />
          <circle 
            cx="1080" 
            cy="202" 
            r="4.5" 
            fill="#16a34a" 
            className={isAlertActive ? 'animate-ping' : ''}
            style={{ transformOrigin: '1080px 202px' }}
          />
          <circle cx="1080" cy="202" r="4.5" fill="#16a34a" />
          <text x="1093" y="206" fontFamily="'Space Mono', monospace" fontSize="12" fontWeight="700" fill="#15803d" letterSpacing=".05em">ALERT</text>
          <text x="1080" y="226" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#16a34a" fontWeight="600">
            {isAlertActive ? 'new update ↗' : 'what changed ↗'}
          </text>
          
          <rect x="1080" y="240" width="86" height="8" rx="2" fill="#e2e8f0"/>
          <rect 
            x="1080" 
            y="240" 
            width={isAlertActive ? 86 : 0} 
            height="8" 
            rx="2" 
            fill="#16a34a" 
            className="transition-all duration-1000 ease-out"
          />
        </g>

        {/* ── REJECT BOX ──────────────────────────────────────────── */}
        <g 
          onClick={() => onBlockClick('REJECTED')}
          className={`cursor-pointer transition-all duration-300 ${isRejectedActive ? 'filter drop-shadow-[0_0_10px_rgba(239,68,68,0.35)]' : ''}`}
        >
          <rect 
            x="158" 
            y="380" 
            width="134" 
            height="66" 
            rx="7" 
            fill={isRejectedActive ? 'url(#rejectGrad)' : '#fff'} 
            stroke={isRejectedActive ? '#ef4444' : activeBlock === 'REJECTED' ? '#ef4444' : '#fecaca'} 
            strokeWidth={isRejectedActive ? '1.8' : '.8'}
          />
          <circle cx="174" cy="404" r="4.5" fill="#ef4444" className={isRejectedActive ? 'animate-pulse' : ''}/>
          <text x="187" y="408" fontFamily="'Space Mono', monospace" fontSize="12" fontWeight="700" fill="#ef4444" letterSpacing=".04em">REJECTED</text>
          <text x="174" y="428" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#9ca3af">before network call</text>
        </g>

        {/* ── MEMORY BAR ────────────────────────────────────────────── */}
        {/* Connection vertical from harness bottom to memory */}
        <line 
          x1="603" 
          y1="310" 
          x2="603" 
          y2="378" 
          stroke={isReasonActive || isActActive || isAlertActive ? '#f97316' : '#b0b8ac'} 
          strokeWidth={isReasonActive || isActActive || isAlertActive ? '1.5' : '.8'} 
          markerEnd={isReasonActive || isActActive || isAlertActive ? 'url(#ao)' : 'url(#a)'}
        />

        <g 
          onClick={() => onBlockClick('MEMORY')}
          className="cursor-pointer group"
        >
          <rect 
            x="318" 
            y="380" 
            width="570" 
            height="76" 
            rx="7" 
            fill="#fff" 
            stroke={activeBlock === 'MEMORY' ? '#f97316' : '#fed7aa'} 
            strokeWidth={activeBlock === 'MEMORY' ? '1.8' : '.8'}
          />
          <circle cx="336" cy="404" r="5" fill="#f97316"/>
          <text x="349" y="408" fontFamily="'Space Mono', monospace" fontSize="12" fontWeight="700" fill="#374151" letterSpacing=".05em">MEMORY</text>
          
          {/* vertical separator */}
          <line x1="418" y1="394" x2="418" y2="414" stroke="#e2e6df" strokeWidth="1"/>
          
          <text x="428" y="408" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10.5" fill="#9ca3af">telemetry cache</text>
          
          {/* Dynamic real-time stats display in Memory block! */}
          <text x="734" y="407" fontFamily="'Space Mono', monospace" fontSize="9" fill="#9ca3af" textAnchor="end">
            {activeScenario?.behaviorType === 'low_confidence' 
              ? 'Sources: 4  ·  Prefs: 1  ·  Alerts: 1'
              : activeScenario?.behaviorType === 'injection'
              ? 'Sources: 0  ·  Prefs: 0  ·  Alerts: 0'
              : 'Sources: 6  ·  Prefs: 1  ·  Alerts: 1'}
          </text>
          
          <g>
            <rect x="742" y="396" width="26" height="14" rx="2.5" fill="#f1f5f9"/>
            <text x="755" y="406.5" fontFamily="'Space Mono', monospace" fontSize="8" fontWeight="700" fill="#475569" textAnchor="middle" letterSpacing=".03em">CPU</text>
            <rect x="771" y="396" width="26" height="14" rx="2.5" fill="#f0fdf4"/>
            <text x="784" y="406.5" fontFamily="'Space Mono', monospace" fontSize="8" fontWeight="700" fill="#15803d" textAnchor="middle" letterSpacing=".03em">DPU</text>
            <rect x="800" y="396" width="33" height="14" rx="2.5" fill="#ede9fe"/>
            <text x="816.5" y="406.5" fontFamily="'Space Mono', monospace" fontSize="8" fontWeight="700" fill="#6d28d9" textAnchor="middle" letterSpacing=".03em">CUDA</text>
            <rect x="836" y="396" width="26" height="14" rx="2.5" fill="#dbeafe"/>
            <text x="849" y="406.5" fontFamily="'Space Mono', monospace" fontSize="8" fontWeight="700" fill="#1d4ed8" textAnchor="middle" letterSpacing=".03em">LLM</text>
            <rect x="865" y="396" width="21" height="14" rx="2.5" fill="#fef3c7"/>
            <text x="875.5" y="406.5" fontFamily="'Space Mono', monospace" fontSize="8" fontWeight="700" fill="#92400e" textAnchor="middle" letterSpacing=".03em">NET</text>
          </g>

          <text x="336" y="438" fontFamily="'IBM Plex Sans', sans-serif" fontSize="10" fill="#9ca3af">
            idempotent writes  ·  deduped URLs  ·  per-stage checkpoints  ·  diff vs stored
          </text>
        </g>
      </svg>
    </div>
  );
};
