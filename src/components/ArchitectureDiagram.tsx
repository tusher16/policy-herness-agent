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
    ? 60 : simulationProgress > 20 && currentStep === 'OBSERVE' ? 44 : 10;
  const pageProgressW = isObserveActive || isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 45 : simulationProgress > 40 && currentStep === 'OBSERVE' ? 24 : 5;
  const parseProgressW = isObserveActive || isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 60 : simulationProgress > 70 && currentStep === 'OBSERVE' ? 36 : 8;

  const diffProgressW = isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 54 : simulationProgress > 30 && currentStep === 'REASON' ? 24 : 8;
  const rankProgressW = isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 48 : simulationProgress > 60 && currentStep === 'REASON' ? 20 : 6;
  const confProgressW = isReasonActive || isActActive || isOutputGuardActive || isAlertActive
    ? 58 : simulationProgress > 80 && currentStep === 'REASON' ? 30 : 10;

  const sumProgressW = isActActive || isOutputGuardActive || isAlertActive
    ? 55 : simulationProgress > 40 && currentStep === 'ACT' ? 25 : 5;
  const notifyProgressW = isActActive || isOutputGuardActive || isAlertActive
    ? 48 : simulationProgress > 70 && currentStep === 'ACT' ? 20 : 5;
  const tokenProgressW = isActActive || isOutputGuardActive || isAlertActive
    ? 60 : simulationProgress > 90 && currentStep === 'ACT' ? 30 : 6;

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
            x="32" 
            y="186" 
            width="100" 
            height="72" 
            rx="7" 
            fill="#fff" 
            stroke={currentStep === 'IDLE' ? '#16a34a' : activeBlock === 'PROMPT' ? '#22c55e' : '#e2e6df'} 
            strokeWidth={currentStep === 'IDLE' ? '1.8' : '1'}
            className="transition-all duration-300"
          />
          {/* Spacing resolved: bullet cx=43, text x=56 (diff is 13px) */}
          <circle cx="43" cy="206" r="3.5" fill="#d1d5db" />
          <text 
            x="56" 
            y="210" 
            fontFamily="'Space Mono', monospace" 
            fontSize="9.5" 
            fontWeight="700" 
            fill="#374151" 
            letterSpacing=".06em"
          >
            PROMPT
          </text>
          <text x="43" y="228" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8.5" fill="#9ca3af">
            human intent
          </text>
          <text 
            x="43" 
            y="244" 
            fontFamily="'IBM Plex Sans', sans-serif" 
            fontSize="8" 
            fill="#16a34a" 
            fontWeight={activeScenario ? '500' : 'normal'}
            fontStyle="italic"
            className="transition-all duration-300 truncate"
          >
            {activeScenario ? activeScenario.category : 'USA student visa'}
          </text>
        </g>

        {/* Topic → Input Guard Connection */}
        <line 
          x1="132" 
          y1="222" 
          x2="160" 
          y2="222" 
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
            x="162" 
            y="158" 
            width="124" 
            height="140" 
            rx="7" 
            fill={isInputGuardActive ? 'url(#selectedGrad)' : '#fff'} 
            stroke={isInputGuardActive ? '#f97316' : activeBlock === 'INPUT GUARDRAIL' ? '#16a34a' : '#e2e6df'} 
            strokeWidth={isInputGuardActive ? '1.5' : '.8'}
          />
          {/* Spacing resolved: bullet cx=178, text x=191 (diff is 13px) */}
          <circle cx="178" cy="178" r="3.5" fill="#f97316"/>
          <text x="191" y="182" fontFamily="'Space Mono', monospace" fontSize="9.5" fontWeight="700" fill="#374151" letterSpacing=".06em">INPUT</text>
          <text x="191" y="198" fontFamily="'Space Mono', monospace" fontSize="9.5" fontWeight="700" fill="#374151" letterSpacing=".06em">GUARDRAIL</text>
          <text x="178" y="216" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8.5" fill="#9ca3af">topic · injection check</text>
          
          <g>
            <rect x="178" y="228" width="27" height="13" rx="2.5" fill="#f1f5f9"/>
            <text x="191.5" y="238.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#475569" textAnchor="middle" letterSpacing=".04em">CPU</text>
            
            <rect x="209" y="228" width="27" height="13" rx="2.5" fill={isInputGuardActive ? '#bbf7d0' : '#f0fdf4'}/>
            <text x="222.5" y="238.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#15803d" textAnchor="middle" letterSpacing=".04em">DPU</text>
          </g>
          
          <line x1="178" y1="249" x2="266" y2="249" stroke="#f3f4f0" strokeWidth=".6"/>
          
          {/* Intelligent Guardrail status labels dynamically red/green depending on payload security! */}
          <text 
            x="178" 
            y="263" 
            fontFamily="'IBM Plex Sans', sans-serif" 
            fontSize="8" 
            fill={activeScenario?.behaviorType === 'injection' && currentStep !== 'IDLE' ? '#ef4444' : '#16a34a'}
            fontWeight={activeScenario?.behaviorType === 'injection' ? '500' : 'normal'}
          >
            {activeScenario?.behaviorType === 'injection' && currentStep !== 'IDLE' ? '✓ query loaded' : '✓ approved topics'}
          </text>
          <text 
            x="178" 
            y="277" 
            fontFamily="'IBM Plex Sans', sans-serif" 
            fontSize="8" 
            fill={activeScenario?.behaviorType === 'injection' && currentStep !== 'IDLE' ? '#ef4444' : '#16a34a'}
            fontWeight={activeScenario?.behaviorType === 'injection' ? '600' : 'normal'}
          >
            {activeScenario?.behaviorType === 'injection' && currentStep !== 'IDLE' ? '✗ injection attack!' : '✓ prompt injection'}
          </text>
          <text 
            x="178" 
            y="291" 
            fontFamily="'IBM Plex Sans', sans-serif" 
            fontSize="8" 
            fill="#16a34a"
          >
            ✓ length limits
          </text>
        </g>

        {/* Input Guard Approved → Harness Flow */}
        <text x="301" y="213" fontFamily="'IBM Plex Sans', sans-serif" fontSize="9" fill={currentStep !== 'IDLE' && currentStep !== 'INPUT_GUARD' && currentStep !== 'REJECTED_STATE' ? '#16a34a' : '#a0a89c'} textAnchor="middle" letterSpacing=".02em">ok</text>
        <line 
          x1="286" 
          y1="220" 
          x2="316" 
          y2="220" 
          stroke={currentStep !== 'IDLE' && currentStep !== 'INPUT_GUARD' && currentStep !== 'REJECTED_STATE' ? '#16a34a' : '#b0b8ac'} 
          strokeWidth={currentStep !== 'IDLE' && currentStep !== 'INPUT_GUARD' && currentStep !== 'REJECTED_STATE' ? '1.5' : '.8'} 
          markerEnd={currentStep !== 'IDLE' && currentStep !== 'INPUT_GUARD' && currentStep !== 'REJECTED_STATE' ? 'url(#ag)' : 'url(#a)'}
        />

        {/* Input Guard Blocked ↓ Reject Flow */}
        <text 
          x="148" 
          y="336" 
          fontFamily="'IBM Plex Sans', sans-serif" 
          fontSize="8.5" 
          fill={isRejectedActive ? '#ef4444' : '#a0a89c'} 
          textAnchor="middle"
          fontWeight={isRejectedActive ? '600' : 'normal'}
        >
          blocked
        </text>
        <line 
          x1="224" 
          y1="298" 
          x2="224" 
          y2="380" 
          stroke={isRejectedActive ? '#ef4444' : '#b0b8ac'} 
          strokeWidth={isRejectedActive ? '1.5' : '.8'} 
          strokeDasharray="4 3" 
          markerEnd={isRejectedActive ? 'url(#ar)' : 'url(#a)'}
        />

        {/* ── HARNESS CONTAINER ──────────────────────────────── */}
        <rect 
          x="318" 
          y="140" 
          width="568" 
          height="166" 
          rx="9" 
          fill="rgba(255,255,255,.38)" 
          stroke={isObserveActive || isReasonActive || isActActive || isFeedbackActive ? '#16a34a' : '#b8c0b4'} 
          strokeWidth={isObserveActive || isReasonActive || isActActive || isFeedbackActive ? '1.8' : '1.2'} 
          strokeDasharray={isObserveActive || isReasonActive || isActActive || isFeedbackActive ? 'none' : '5 4'}
          className="transition-all duration-300"
        />
        {/* floating harness label */}
        <rect x="334" y="132" width="252" height="16" fill="#eef1ec" />
        <text x="342" y="144" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8.5" fill="#a0a89c" letterSpacing=".04em">agent harness  ·  observe → reason → act</text>

        {/* ── OBSERVE BLOCK ────────────────────────────────────────────────── */}
        <g 
          onClick={() => onBlockClick('OBSERVE')}
          className={getBlockClasses('OBSERVE', isObserveActive, 'stroke-emerald-500')}
        >
          <rect 
            x="334" 
            y="157" 
            width="162" 
            height="134" 
            rx="7" 
            fill={isObserveActive ? 'url(#observeGrad)' : '#fff'} 
            stroke={isObserveActive ? '#16a34a' : activeBlock === 'OBSERVE' ? '#16a34a' : '#e2e6df'} 
            strokeWidth={isObserveActive ? '1.5' : '.8'}
          />
          {/* Active green left accent */}
          <rect x="334" y="157" width="3" height="134" rx="1.5" fill="#16a34a"/>
          {/* Spacing resolved: bullet cx=348, text x=361 (diff is 13px) */}
          <circle cx="348" cy="178" r="3.5" fill="#16a34a" />
          <text x="361" y="183" fontFamily="'Space Mono', monospace" fontSize="11" fontWeight="700" fill="#111" letterSpacing=".05em">OBSERVE</text>
          <text x="348" y="201" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8.5" fill="#9ca3af">official source search</text>
          
          <rect x="348" y="211" width="24" height="13" rx="2.5" fill="#dbeafe"/>
          <text x="360" y="221.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#1d4ed8" textAnchor="middle" letterSpacing=".04em">LLM</text>
          
          {/* Dynamic Observe status rows & progress meters */}
          <text x="348" y="239" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#a0a89c">web_search</text>
          <rect x="418" y="231" width="60" height="8" rx="2" fill="#f3f4f0"/>
          <rect x="418" y="231" width={searchProgressW} height="8" rx="2" fill="#10b981" className="transition-all duration-500"/>
          
          <text x="348" y="255" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#a0a89c">page_fetcher</text>
          <rect x="418" y="247" width="60" height="8" rx="2" fill="#f3f4f0"/>
          <rect x="418" y="247" width={pageProgressW} height="8" rx="2" fill="#34d399" className="transition-all duration-500"/>
          
          <text x="348" y="271" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#16a34a" fontWeight="500">
            {activeScenario ? `${activeScenario.observeResults.sources.length} sources found` : '6 sources found'}
          </text>
          <rect x="418" y="263" width="60" height="8" rx="2" fill="#f3f4f0"/>
          <rect x="418" y="263" width={parseProgressW} height="8" rx="2" fill="#047857" className="transition-all duration-500"/>
        </g>

        {/* OBSERVE → REASON Flow Arrow */}
        <line 
          x1="496" 
          y1="222" 
          x2="514" 
          y2="222" 
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
            x="516" 
            y="157" 
            width="162" 
            height="134" 
            rx="7" 
            fill={isReasonActive ? 'url(#observeGrad)' : '#fff'} 
            stroke={isReasonActive ? '#16a34a' : activeBlock === 'REASON' ? '#16a34a' : '#e2e6df'} 
            strokeWidth={isReasonActive ? '1.5' : '.8'}
          />
          <rect x="516" y="157" width="3" height="134" rx="1.5" fill="#16a34a"/>
          {/* Spacing resolved: bullet cx=530, text x=543 (diff is 13px) */}
          <circle cx="530" cy="178" r="3.5" fill="#16a34a" />
          <text x="543" y="183" fontFamily="'Space Mono', monospace" fontSize="11" fontWeight="700" fill="#111" letterSpacing=".05em">REASON</text>
          <text x="530" y="201" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8.5" fill="#9ca3af">policy analysis</text>
          
          <rect x="530" y="211" width="24" height="13" rx="2.5" fill="#dbeafe"/>
          <text x="542" y="221.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#1d4ed8" textAnchor="middle" letterSpacing=".04em">LLM</text>
          
          {/* Dynamically tracking Reason progress elements */}
          <text x="530" y="239" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#a0a89c">diff_engine</text>
          <rect x="600" y="231" width="60" height="8" rx="2" fill="#f3f4f0"/>
          <rect x="600" y="231" width={diffProgressW} height="8" rx="2" fill="#10b981" className="transition-all duration-500"/>
          
          <text x="530" y="255" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#a0a89c">source ranking</text>
          <rect x="600" y="247" width="60" height="8" rx="2" fill="#f3f4f0"/>
          <rect x="600" y="247" width={rankProgressW} height="8" rx="2" fill="#34d399" className="transition-all duration-500"/>
          
          <text x="530" y="271" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#16a34a" fontWeight="500">
            confidence: {displayedConfidence}
          </text>
          <rect x="600" y="263" width="60" height="8" rx="2" fill="#f3f4f0"/>
          <rect 
            x="600" y="263" 
            width={activeScenario?.behaviorType === 'low_confidence' && isFeedbackActive ? 22 : confProgressW} 
            height="8" rx="2" 
            fill={activeScenario?.behaviorType === 'low_confidence' && isFeedbackActive ? '#f97316' : '#047857'} 
            className="transition-all duration-500"
          />
        </g>

        {/* REASON → ACT Flow Arrow */}
        <line 
          x1="678" 
          y1="222" 
          x2="696" 
          y2="222" 
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
            x="698" 
            y="157" 
            width="162" 
            height="134" 
            rx="7" 
            fill={isActActive ? 'url(#observeGrad)' : '#fff'} 
            stroke={isActActive ? '#16a34a' : activeBlock === 'ACT' ? '#16a34a' : '#e2e6df'} 
            strokeWidth={isActActive ? '1.5' : '.8'}
          />
          <rect x="698" y="157" width="3" height="134" rx="1.5" fill="#16a34a"/>
          {/* Spacing resolved: bullet cx=712, text x=725 (diff is 13px) */}
          <circle cx="712" cy="178" r="3.5" fill="#16a34a" />
          <text x="725" y="183" fontFamily="'Space Mono', monospace" fontSize="11" fontWeight="700" fill="#111" letterSpacing=".05em">ACT</text>
          <text x="712" y="201" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8.5" fill="#9ca3af">actionable alert</text>
          
          <rect x="712" y="211" width="24" height="13" rx="2.5" fill="#dbeafe"/>
          <text x="724" y="221.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#1d4ed8" textAnchor="middle" letterSpacing=".04em">LLM</text>
          
          {/* Dynamic Act progress elements and pricing */}
          <text x="712" y="239" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#a0a89c">summarizer</text>
          <rect x="782" y="231" width="60" height="8" rx="2" fill="#f3f4f0"/>
          <rect x="782" y="231" width={sumProgressW} height="8" rx="2" fill="#10b981" className="transition-all duration-500"/>
          
          <text x="712" y="255" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#a0a89c">notifier</text>
          <rect x="782" y="247" width="60" height="8" rx="2" fill="#f3f4f0"/>
          <rect x="782" y="247" width={notifyProgressW} height="8" rx="2" fill="#34d399" className="transition-all duration-500"/>
          
          <text x="712" y="271" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#16a34a" fontWeight="500">
            {activeScenario ? `${activeScenario.actResults.tokensUsed} tok · $${activeScenario.actResults.costUsd.toFixed(5)}` : '2100 tok · $0.00004'}
          </text>
          <rect x="782" y="263" width="60" height="8" rx="2" fill="#f3f4f0"/>
          <rect x="782" y="263" width={tokenProgressW} height="8" rx="2" fill="#047857" className="transition-all duration-500"/>
        </g>

        {/* ── FEEDBACK ARC (REASON → OBSERVE when low confidence) ────── */}
        <g className="transition-opacity duration-300">
          <path 
            d="M597,291 L597,334 L415,334 L415,291" 
            fill="none" 
            stroke={isFeedbackActive ? '#f97316' : '#b0b8ac'} 
            strokeWidth={isFeedbackActive ? '1.8' : '.8'} 
            strokeDasharray={isFeedbackActive ? 'none' : '4 3'} 
            markerEnd={isFeedbackActive ? 'url(#ao)' : 'url(#a)'}
            className="transition-all duration-300"
          />
          <rect 
            x="446" 
            y="326" 
            width="162" 
            height="16" 
            rx="3" 
            fill={isFeedbackActive ? '#ffedd5' : '#eef1ec'} 
            className="transition-colors duration-300"
          />
          <text 
            x="527" 
            y="338" 
            fontFamily="'IBM Plex Sans', sans-serif" 
            fontSize="8" 
            fill={isFeedbackActive ? '#c2410c' : '#9ca3af'} 
            textAnchor="middle" 
            fontStyle="italic"
            fontWeight={isFeedbackActive ? 'bold' : 'normal'}
            className="transition-all duration-300"
          >
            {isFeedbackActive ? '↺  low confidence · REcheck triggered!' : '↺  low confidence · re-search'}
          </text>
        </g>

        {/* Harness → Output Guard Connector */}
        <line 
          x1="886" 
          y1="222" 
          x2="910" 
          y2="222" 
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
            y="158" 
            width="124" 
            height="140" 
            rx="7" 
            fill={isOutputGuardActive ? 'url(#selectedGrad)' : '#fff'} 
            stroke={isOutputGuardActive ? '#f97316' : activeBlock === 'OUTPUT GUARDRAIL' ? '#16a34a' : '#e2e6df'} 
            strokeWidth={isOutputGuardActive ? '1.5' : '.8'}
          />
          {/* Spacing resolved: bullet cx=928, text x=941 (diff is 13px) */}
          <circle cx="928" cy="178" r="3.5" fill="#f97316"/>
          <text x="941" y="182" fontFamily="'Space Mono', monospace" fontSize="9.5" fontWeight="700" fill="#374151" letterSpacing=".06em">OUTPUT</text>
          <text x="941" y="198" fontFamily="'Space Mono', monospace" fontSize="9.5" fontWeight="700" fill="#374151" letterSpacing=".06em">GUARDRAIL</text>
          <text x="928" y="216" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8.5" fill="#9ca3af">citation · confidence</text>
          
          <rect x="928" y="228" width="27" height="13" rx="2.5" fill="#f1f5f9"/>
          <text x="941.5" y="238.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#475569" textAnchor="middle" letterSpacing=".04em">CPU</text>
          
          <rect x="959" y="228" width="27" height="13" rx="2.5" fill="#f0fdf4"/>
          <text x="972.5" y="238.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#15803d" textAnchor="middle" letterSpacing=".04em">DPU</text>
          
          {/* Output audit checks */}
          <text x="928" y="263" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#16a34a">✓ legal disclaimer</text>
          <text x="928" y="277" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#16a34a">✓ confidence score</text>
          <text x="928" y="291" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#16a34a">✓ source citations</text>
        </g>

        {/* Output Guard Approved → SUCCESS ALERT FLOW */}
        <line 
          x1="1036" 
          y1="222" 
          x2="1060" 
          y2="222" 
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
            x="1062" 
            y="186" 
            width="112" 
            height="72" 
            rx="7" 
            fill={isAlertActive ? '#f0fdf4' : '#fff'} 
            stroke={isAlertActive ? '#16a34a' : activeBlock === 'ALERT' ? '#16a34a' : '#86efac'} 
            strokeWidth={isAlertActive ? '2' : '.8'}
          />
          {/* Spacing resolved: bullet cx=1076, text x=1089 (diff is 13px) */}
          <circle cx="1076" cy="206" r="3.5" fill="#16a34a" className={isAlertActive ? 'animate-ping' : ''}/>
          <circle cx="1076" cy="206" r="3.5" fill="#16a34a" />
          <text x="1089" y="210" fontFamily="'Space Mono', monospace" fontSize="9.5" fontWeight="700" fill="#15803d" letterSpacing=".05em">ALERT</text>
          <text x="1076" y="228" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8.5" fill="#16a34a" fontWeight="500">
            {isAlertActive ? 'new update ↗' : 'what changed ↗'}
          </text>
          
          <rect x="1076" y="242" width="85" height="7" rx="2" fill="#e2e8f0"/>
          <rect 
            x="1076" 
            y="242" 
            width={isAlertActive ? 85 : 0} 
            height="7" 
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
            x="162" 
            y="380" 
            width="124" 
            height="52" 
            rx="7" 
            fill={isRejectedActive ? 'url(#rejectGrad)' : '#fff'} 
            stroke={isRejectedActive ? '#ef4444' : activeBlock === 'REJECTED' ? '#ef4444' : '#fecaca'} 
            strokeWidth={isRejectedActive ? '1.8' : '.8'}
          />
          {/* Spacing resolved: bullet cx=178, text x=191 (diff is 13px) */}
          <circle cx="178" cy="400" r="3.5" fill="#ef4444" className={isRejectedActive ? 'animate-pulse' : ''}/>
          <text x="191" y="404" fontFamily="'Space Mono', monospace" fontSize="9.5" fontWeight="700" fill="#ef4444" letterSpacing=".04em">REJECTED</text>
          <text x="178" y="422" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8" fill="#9ca3af">before network call</text>
        </g>

        {/* ── MEMORY BAR ────────────────────────────────────────────── */}
        {/* Connection vertical from harness bottom to memory */}
        <line 
          x1="602" 
          y1="306" 
          x2="602" 
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
            width="568" 
            height="66" 
            rx="7" 
            fill="#fff" 
            stroke={activeBlock === 'MEMORY' ? '#f97316' : '#fed7aa'} 
            strokeWidth={activeBlock === 'MEMORY' ? '1.8' : '.8'}
          />
          {/* Spacing resolved: bullet cx=336, text x=349 (diff is 13px) */}
          <circle cx="336" cy="404" r="4" fill="#f97316"/>
          <text x="349" y="408" fontFamily="'Space Mono', monospace" fontSize="10" fontWeight="700" fill="#374151" letterSpacing=".05em">MEMORY</text>
          
          {/* vertical separator */}
          <line x1="436" y1="394" x2="436" y2="414" stroke="#e2e6df" strokeWidth="1"/>
          
          <text x="446" y="404" fontFamily="'IBM Plex Sans', sans-serif" fontSize="8.5" fill="#9ca3af">sources · preferences · alerts</text>
          
          {/* Dynamic real-time stats display in Memory block! */}
          <text x="734" y="401" fontFamily="'Space Mono', monospace" fontSize="7.5" fill="#9ca3af" textAnchor="end">
            {activeScenario?.behaviorType === 'low_confidence' 
              ? 'Sources: 4  ·  Prefs: 1  ·  Alerts: 1'
              : activeScenario?.behaviorType === 'injection'
              ? 'Sources: 0  ·  Prefs: 0  ·  Alerts: 0'
              : 'Sources: 6  ·  Prefs: 1  ·  Alerts: 1'}
          </text>
          
          <g>
            <rect x="742" y="393" width="26" height="13" rx="2.5" fill="#f1f5f9"/>
            <text x="755" y="403.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#475569" textAnchor="middle" letterSpacing=".03em">CPU</text>
            <rect x="771" y="393" width="26" height="13" rx="2.5" fill="#f0fdf4"/>
            <text x="784" y="403.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#15803d" textAnchor="middle" letterSpacing=".03em">DPU</text>
            <rect x="800" y="393" width="33" height="13" rx="2.5" fill="#ede9fe"/>
            <text x="816.5" y="403.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#6d28d9" textAnchor="middle" letterSpacing=".03em">CUDA</text>
            <rect x="836" y="393" width="26" height="13" rx="2.5" fill="#dbeafe"/>
            <text x="849" y="403.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#1d4ed8" textAnchor="middle" letterSpacing=".03em">LLM</text>
            <rect x="865" y="393" width="21" height="13" rx="2.5" fill="#fef3c7"/>
            <text x="875.5" y="403.5" fontFamily="'Space Mono', monospace" fontSize="7.5" fontWeight="700" fill="#92400e" textAnchor="middle" letterSpacing=".03em">NET</text>
          </g>

          <text x="336" y="434" fontFamily="'IBM Plex Sans', sans-serif" fontSize="7.5" fill="#9ca3af">
            idempotent writes  ·  deduped URLs  ·  per-stage checkpoints  ·  diff vs stored
          </text>
        </g>
      </svg>
    </div>
  );
};
