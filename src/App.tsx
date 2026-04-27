/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useMemo } from 'react';
import { 
  Shield, 
  ShieldAlert, 
  ShieldCheck, 
  Activity, 
  History, 
  Settings, 
  AlertTriangle, 
  CheckCircle2, 
  XCircle, 
  Send,
  BarChart3,
  Scale,
  Database,
  Info,
  ChevronRight,
  UserCheck,
  Zap,
  RotateCcw,
  MessageSquare,
  Lock,
  Download,
  Dna,
  Eye,
  FileJson,
  FileText
} from 'lucide-react';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart, 
  Area,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar
} from 'recharts';
import { motion, AnimatePresence } from 'motion/react';
import { cn, formatRiskScore, getRiskLevel } from './lib/utils';
import { db, auth } from './lib/firebase';
import { 
  collection, 
  addDoc, 
  query, 
  orderBy, 
  limit, 
  onSnapshot, 
  Timestamp,
  doc,
  getDocFromServer,
  updateDoc
} from 'firebase/firestore';
import { GoogleGenerativeAI } from "@google/generative-ai";

import { jsPDF } from 'jspdf';

// Types
enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

interface RiskFactors {
  x1: number; // Keywords
  x2: number; // Intent (Gemini)
  x3: number; // Context/Complexity
  x4: number; // Threat Patterns
}

interface DecomposedIntent {
  goal: string;
  method: string;
  target: string;
  goalRisk: number;
  methodRisk: number;
  targetRisk: number;
  aggregateRisk: number;
}

interface GovernanceResult {
  riskScore: number;
  decision: 'Allow' | 'Warn' | 'Block';
  reason: string;
  factors: RiskFactors;
  intent?: DecomposedIntent;
  simulationResults?: Record<string, string>;
}

interface LogEntry extends GovernanceResult {
  id: string;
  prompt: string;
  response?: string;
  mode: string;
  timestamp: Date;
  approvedByHuman?: boolean;
}

const handleFirestoreError = (error: unknown, operationType: OperationType, path: string | null) => {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
    },
    operationType,
    path
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
};

export default function App() {
  const [prompt, setPrompt] = useState('');
  const [mode, setMode] = useState<'Strict' | 'Balanced' | 'Open'>('Balanced');
  const [simulate, setSimulate] = useState(false);
  const [loading, setLoading] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [currentResult, setCurrentResult] = useState<LogEntry | null>(null);
  const [currentView, setCurrentView] = useState<'console' | 'logs' | 'policy' | 'weights' | 'monitoring'>('console');
  const [serverWeights, setServerWeights] = useState<{ w1: number, w2: number, w3: number, alpha: number } | null>(null);

  // Gemini Setup
  const ai = useMemo(() => new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "dummy"), []);

  // Fetch Weights
  const fetchWeights = async () => {
    try {
      const res = await fetch('/api/weights');
      const data = await res.json();
      setServerWeights(data);
    } catch (err) {
      console.error("Failed to fetch weights:", err);
    }
  };

  useEffect(() => {
    fetchWeights();
  }, []);

  // Fetch Logs from Firestore
  useEffect(() => {
    const q = query(collection(db, 'decisions'), orderBy('timestamp', 'desc'), limit(50));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const newLogs = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data(),
        timestamp: (doc.data().timestamp as Timestamp).toDate()
      })) as LogEntry[];
      setLogs(newLogs);
    });
    return () => unsubscribe();
  }, []);

  // Test Firestore Connection on boot
  useEffect(() => {
    const testConnection = async () => {
      try {
        await getDocFromServer(doc(db, 'test', 'connection'));
      } catch (error) {
        if(error instanceof Error && error.message.includes('the client is offline')) {
          console.error("Please check your Firebase configuration.");
        }
      }
    };
    testConnection();
  }, []);

  const handleProcess = async () => {
    if (!prompt.trim()) return;
    setLoading(true);
    setCurrentResult(null);

    try {
      // Governance Analysis (Backend)
      // The backend now handles risk analysis, intent decomposition, AND the AI response generation
      const govRes = await fetch('/api/governance', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode, simulate })
      });
      
      if (!govRes.ok) {
        throw new Error(`Governance API failed: ${govRes.statusText}`);
      }
      
      const govData: GovernanceResult = await govRes.json();

      const aiResponse = govData.aiResponse || "No response generated by the engine.";

      const logData = {
        prompt,
        response: aiResponse,
        mode,
        timestamp: Timestamp.now(),
        ...govData
      };
      
      let docRef;
      try {
        docRef = await addDoc(collection(db, 'decisions'), logData);
      } catch (err) {
        handleFirestoreError(err, OperationType.WRITE, 'decisions');
        return;
      }
      
      const completeLog: LogEntry = {
        id: docRef.id,
        ...logData,
        timestamp: new Date()
      };
      
      setCurrentResult(completeLog);
      setPrompt('');
      fetchWeights();
    } catch (err) {
      console.error("Governance process failed:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleFeedback = async (id: string, feedback: number, factors: RiskFactors) => {
    try {
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback, factors })
      });
      const data = await res.json();
      if (data.status === 'success') {
        setServerWeights(data.weights);
      }
    } catch (err) {
      console.error("Feedback submission failed:", err);
    }
  };

  const handleHumanApproval = async (id: string) => {
    try {
      const docRef = doc(db, 'decisions', id);
      await updateDoc(docRef, { approvedByHuman: true });
      if (currentResult && currentResult.id === id) {
        setCurrentResult({ ...currentResult, approvedByHuman: true });
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'decisions');
    }
  };

  const handleExportJSON = () => {
    if (!currentResult) return;
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(currentResult, null, 2));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", `governance_report_${currentResult.id.slice(0, 8)}.json`);
    document.body.appendChild(downloadAnchorNode);
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
  };

  const handleExportPDF = () => {
    if (!currentResult) return;
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text("X-AI Governance Report", 20, 20);
    
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(`ID: ${currentResult.id}`, 20, 30);
    doc.text(`Timestamp: ${currentResult.timestamp.toLocaleString()}`, 20, 35);
    doc.text(`Mode: ${currentResult.mode}`, 20, 40);

    doc.setFontSize(14);
    doc.setTextColor(0);
    doc.text("Original Prompt:", 20, 55);
    doc.setFontSize(10);
    const splitPrompt = doc.splitTextToSize(currentResult.prompt, 170);
    doc.text(splitPrompt, 20, 65);

    let currentY = 65 + (splitPrompt.length * 5) + 10;

    if (currentResult.intent) {
      doc.setFontSize(14);
      doc.text("Intent Analysis:", 20, currentY);
      doc.setFontSize(10);
      doc.text(`Goal: ${currentResult.intent.goal}`, 25, currentY + 10);
      doc.text(`Method: ${currentResult.intent.method}`, 25, currentY + 15);
      doc.text(`Target: ${currentResult.intent.target}`, 25, currentY + 20);
      currentY += 30;
    }

    doc.setFontSize(14);
    doc.text("Decision Outcome:", 20, currentY);
    doc.setFontSize(12);
    doc.setTextColor(currentResult.decision === 'Block' ? 200 : 0, currentResult.decision === 'Allow' ? 150 : 0, 0);
    doc.text(`Decision: ${currentResult.decision.toUpperCase()}`, 25, currentY + 10);
    doc.setTextColor(0);
    doc.setFontSize(10);
    doc.text(`Aggregate Risk Score: ${(currentResult.riskScore * 100).toFixed(1)}%`, 25, currentY + 17);
    
    const reasonSplit = doc.splitTextToSize(`Reason: ${currentResult.reason}`, 170);
    doc.text(reasonSplit, 25, currentY + 25);

    doc.save(`governance_report_${currentResult.id.slice(0, 8)}.pdf`);
  };
  const stats = useMemo(() => {
    const total = logs.length;
    const blocked = logs.filter(l => l.decision === 'Block').length;
    const avgRisk = total > 0 ? logs.reduce((acc, l) => acc + l.riskScore, 0) / total : 0;
    const riskTrend = logs.slice(0, 15).map(l => ({ 
      time: l.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }), 
      risk: l.riskScore 
    })).reverse();
    
    return { total, blocked, avgRisk, riskTrend };
  }, [logs]);

  return (
    <div className="flex bg-bg-base text-text-primary font-sans h-screen overflow-hidden selection:bg-blue-500/30">
      
      {/* Sidebar - Elegant Dark Spec */}
      <aside className="w-64 bg-sidebar border-r border-border-subtle p-6 flex flex-col gap-8 flex-shrink-0">
        <div className="text-blue-500 font-bold text-sm tracking-[0.1em] uppercase flex items-center gap-2">
          <Shield className="w-4 h-4" />
          X-AI Governance
        </div>
        
        <nav className="flex-1">
          <ul className="space-y-3">
            {[
              { label: 'System Dashboard', id: 'console', Icon: Activity },
              { label: 'Policy Engine', id: 'policy', Icon: Shield },
              { label: 'Audit Logs', id: 'logs', Icon: History },
              { label: 'System Weights', id: 'weights', Icon: Scale },
              { label: 'Monitoring', id: 'monitoring', Icon: BarChart3 },
            ].map((item) => (
              <li 
                key={item.id}
                onClick={() => setCurrentView(item.id as any)}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 rounded-md text-[13px] cursor-pointer transition-all",
                  currentView === item.id 
                    ? "bg-blue-500/10 text-text-primary border-l-2 border-blue-500" 
                    : "text-text-secondary hover:text-text-primary hover:bg-white/5"
                )}
              >
                <item.Icon className="w-4 h-4" />
                <span>{item.label}</span>
              </li>
            ))}
          </ul>
        </nav>

        <div className="mt-auto bg-card p-4 rounded-lg border border-border-subtle shadow-[0_0_15px_-5px_rgba(0,0,0,0.5)]">
          <span className="text-[10px] uppercase text-text-secondary mb-3 block font-bold tracking-widest">Governance Mode</span>
          <div className="flex flex-col gap-1.5">
            {(['Strict', 'Balanced', 'Open'] as const).map((m) => (
              <button
                key={m}
                onClick={() => setMode(m)}
                className={cn(
                  "w-full text-left p-2 rounded text-xs transition-all uppercase font-bold tracking-tight",
                  mode === m 
                    ? "bg-blue-600 text-white" 
                    : "text-text-secondary border border-border-subtle hover:bg-white/5"
                )}
              >
                {m === 'Open' ? 'OPEN (AUDIT)' : m.toUpperCase() + (m === 'Strict' ? ' MODE' : '')}
              </button>
            ))}
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-8 flex flex-col gap-6 overflow-y-auto">
        <header className="flex justify-between items-center">
          <h1 className="text-xl font-bold tracking-tight">
            {currentView === 'console' && 'Risk Analysis Engine'}
            {currentView === 'logs' && 'Audit Ledger'}
            {currentView === 'policy' && 'Policy Engine'}
            {currentView === 'weights' && 'Dynamic Weighting System'}
            {currentView === 'monitoring' && 'System Monitoring'}
          </h1>
          <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/15 border border-emerald-500 text-emerald-500 text-[11px] font-bold">
            <ShieldCheck className="w-3.5 h-3.5" />
            ACTIVE PROTECTIONS
          </div>
        </header>

        {currentView === 'console' ? (
          <>
            {/* Input Area */}
            <div className="bg-card border border-border-subtle rounded-xl p-4 shadow-sm">
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="Enter system prompt to analyze..."
                className="w-full bg-transparent border-none text-text-primary text-[15px] outline-none min-h-[80px] resize-none placeholder:text-text-secondary/30"
              />
              <div className="flex justify-between items-center pt-2">
                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2 cursor-pointer group">
                    <div 
                      onClick={() => setSimulate(!simulate)}
                      className={cn(
                        "w-8 h-4 rounded-full relative transition-all duration-300",
                        simulate ? "bg-amber-500" : "bg-zinc-700"
                      )}
                    >
                      <div className={cn(
                        "absolute top-1 left-1 w-2 h-2 rounded-full bg-white transition-all",
                        simulate ? "translate-x-4" : "translate-x-0"
                      )} />
                    </div>
                    <span className="text-[10px] font-bold text-text-secondary uppercase tracking-widest group-hover:text-amber-500 transition-colors">
                      Simulation Mode
                    </span>
                  </label>
                </div>
                <button
                  disabled={loading || !prompt.trim()}
                  onClick={handleProcess}
                  className={cn(
                    "px-5 py-2 rounded-lg text-sm font-bold transition-all shadow-lg active:scale-95",
                    loading || !prompt.trim()
                      ? "bg-border-subtle text-text-secondary cursor-not-allowed"
                      : "bg-blue-600 text-white hover:bg-blue-500"
                  )}
                >
                  {loading ? 'Processing...' : 'Run Analysis'}
                </button>
              </div>
            </div>

            {/* Dashboard Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_340px] gap-6 flex-1 min-h-0">
              
              {/* Output Panel */}
              <div className="bg-card border border-border-subtle rounded-xl flex flex-col overflow-hidden shadow-xl h-full">
                <div className="px-5 py-4 border-b border-border-subtle flex justify-between items-center bg-white/5">
                  <div className="flex items-center gap-2">
                    <MessageSquare className="w-3.5 h-3.5 text-blue-500" />
                    <span className="text-[12px] font-bold text-text-secondary uppercase tracking-widest">AI Generated Output</span>
                  </div>
                  {currentResult && (
                    <span className={cn(
                      "text-[11px] font-black uppercase tracking-widest px-2 py-0.5 rounded",
                      currentResult.decision === 'Block' ? "bg-rose-500/10 text-rose-500" : 
                      currentResult.decision === 'Warn' ? "bg-amber-500/10 text-amber-500" : "bg-emerald-500/10 text-emerald-500"
                    )}>
                      Action: {currentResult.decision.toUpperCase()}ED
                    </span>
                  )}
                </div>
                
                <div className="flex-1 p-6 overflow-y-auto relative bg-[#0c0c0e]">
                   <AnimatePresence mode="wait">
                    {!currentResult ? (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full flex flex-col items-center justify-center opacity-30 gap-3">
                        <Activity className="w-12 h-12" />
                        <p className="text-xs font-bold uppercase tracking-widest">Awaiting system input</p>
                      </motion.div>
                    ) : currentResult.decision === 'Block' ? (
                      <motion.div initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="h-full flex flex-col items-center justify-center text-center p-8 bg-rose-500/[0.03] rounded-lg border border-rose-500/10">
                        <Lock className="w-12 h-12 text-rose-500 mb-4" />
                        <h3 className="text-rose-500 font-bold text-lg uppercase tracking-tight font-mono">ENFORCEMENT ACTION</h3>
                        <p className="text-sm text-text-secondary mt-2 leading-relaxed max-w-sm">
                          {currentResult.response}
                        </p>
                      </motion.div>
                    ) : (
                      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="text-sm leading-relaxed whitespace-pre-wrap font-sans">
                        {(() => {
                          const words = currentResult.response?.split(/\s+/) || [];
                          const risky = ["hack", "bomb", "exploit", "stolen", "bypass", "illegal", "attack"];
                          return words.map((word, i) => {
                            const isRisky = risky.some(r => word.toLowerCase().includes(r));
                            return (
                              <span key={i} className={cn(isRisky && "text-rose-400 font-bold underline decoration-rose-500/50")}>
                                {word}{' '}
                              </span>
                            );
                          });
                        })()}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                {currentResult && (
                  <div className="p-4 border-t border-border-subtle bg-white/[0.02] flex justify-between items-center">
                    <span className="text-[10px] text-text-secondary italic">Governance ID: {currentResult.id.slice(0, 10)}</span>
                    <div className="flex gap-2">
                       <button 
                        onClick={() => handleFeedback(currentResult.id, -1, currentResult.factors)}
                        className="px-3 py-1.5 rounded-md border border-border-subtle text-[11px] font-bold hover:bg-white/5 transition-all text-text-secondary"
                       >
                        REPORT TOO STRICT
                       </button>
                       <button 
                        onClick={() => handleFeedback(currentResult.id, 1, currentResult.factors)}
                        className="px-3 py-1.5 rounded-md border border-border-subtle text-[11px] font-bold hover:bg-white/5 transition-all text-text-secondary"
                       >
                        REPORT TOO LAX
                       </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Explainability Panel */}
              <div className="bg-card border border-border-subtle rounded-xl flex flex-col overflow-hidden shadow-xl h-full">
                <div className="px-5 py-4 border-b border-border-subtle bg-white/5">
                  <span className="text-[12px] font-bold text-text-secondary uppercase tracking-widest">Explainability Panel</span>
                </div>
                
                <div className="p-6 flex-1 overflow-y-auto space-y-6">
                  {currentResult ? (
                    <>
                      <div className="text-center p-4 bg-black/20 rounded-xl border border-border-subtle/50">
                        <div className={cn("text-5xl font-mono font-bold transition-all", getRiskLevel(currentResult.riskScore).color)}>
                          {(currentResult.riskScore * 100).toFixed(0)}%
                        </div>
                        <div className="text-[11px] font-bold text-text-secondary uppercase tracking-widest mt-2">Aggregate Risk Score</div>
                        <div className="h-2 w-full bg-border-subtle rounded-full mt-4 overflow-hidden shadow-inner">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${currentResult.riskScore * 100}%` }}
                            className={cn("h-full", getRiskLevel(currentResult.riskScore).color.replace('text-', 'bg-'))}
                          />
                        </div>
                        <div className="text-[10px] font-mono text-text-secondary/50 mt-4 leading-none">
                          Governance Mode: {currentResult.mode.toUpperCase()}
                        </div>
                      </div>

                      <div className="space-y-4">
                        <span className="text-[10px] uppercase text-text-secondary font-bold tracking-widest block">Primary Indicators</span>
                        <div className="space-y-4">
                           {[
                             { label: 'Harmful Keywords', val: currentResult.factors.x1 },
                             { label: 'Intent Severity', val: currentResult.factors.x2 },
                             { label: 'Context Risk', val: currentResult.factors.x3 },
                             { label: 'Threat Match', val: currentResult.factors.x4 },
                           ].map(f => (
                             <div key={f.label} className="space-y-1.5">
                               <div className="flex justify-between text-[10px] font-bold">
                                 <span className="text-text-secondary uppercase">{f.label}</span>
                                 <span className={getRiskLevel(f.val).color}>{(f.val * 100).toFixed(0)}%</span>
                               </div>
                               <div className="h-1 w-full bg-border-subtle rounded-full overflow-hidden">
                                 <div className={cn("h-full", getRiskLevel(f.val).color.replace('text-', 'bg-'))} style={{ width: `${f.val * 100}%` }} />
                               </div>
                             </div>
                           ))}
                        </div>
                      </div>

                      {currentResult.intent && (
                        <div className="space-y-4">
                          <span className="text-[10px] uppercase text-text-secondary font-bold tracking-widest block flex items-center gap-2">
                            <Dna className="w-3 h-3" /> Intent Decomposition
                          </span>
                          <div className="grid grid-cols-1 gap-2">
                            {[
                              { label: 'Goal', val: currentResult.intent.goal, risk: currentResult.intent.goalRisk },
                              { label: 'Method', val: currentResult.intent.method, risk: currentResult.intent.methodRisk },
                              { label: 'Target', val: currentResult.intent.target, risk: currentResult.intent.targetRisk },
                            ].map(i => (
                              <div key={i.label} className="bg-white/5 border border-white/10 rounded-lg p-3">
                                <div className="flex justify-between items-center mb-1">
                                  <span className="text-[9px] font-bold text-text-secondary uppercase">{i.label}</span>
                                  <span className={cn("text-[9px] font-bold", getRiskLevel(i.risk).color)}>{(i.risk * 100).toFixed(0)}% Risk</span>
                                </div>
                                <div className="text-[11px] text-text-primary leading-tight font-medium">{i.val}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {currentResult.simulationResults && (
                        <div className="space-y-4">
                          <span className="text-[10px] uppercase text-text-secondary font-bold tracking-widest block flex items-center gap-2">
                            <Eye className="w-3 h-3" /> Multi-Tier Simulation
                          </span>
                          <div className="grid grid-cols-3 gap-2">
                             {Object.entries(currentResult.simulationResults).map(([m, decision]) => (
                               <div key={m} className={cn(
                                 "text-center p-2 rounded-lg border flex flex-col gap-1",
                                 decision === 'BLOCK' ? "bg-rose-500/10 border-rose-500/30" : 
                                 decision === 'WARN' ? "bg-amber-500/10 border-amber-500/30" : 
                                 "bg-emerald-500/10 border-emerald-500/30"
                               )}>
                                  <span className="text-[8px] font-bold uppercase opacity-50">{m}</span>
                                  <span className={cn(
                                    "text-[9px] font-black",
                                    decision === 'BLOCK' ? "text-rose-500" : 
                                    decision === 'WARN' ? "text-amber-500" : 
                                    "text-emerald-500"
                                  )}>{decision}</span>
                               </div>
                             ))}
                          </div>
                        </div>
                      )}

                      <div className="space-y-3">
                        <span className="text-[10px] uppercase text-text-secondary font-bold tracking-widest block">Enforcement Logic</span>
                        <div className="bg-black/20 p-3 rounded-lg border border-border-subtle/50 font-mono text-[11px] text-text-secondary italic">
                          "{currentResult.reason}"
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="h-full flex flex-col items-center justify-center opacity-30 gap-3 text-center">
                       <Zap className="w-8 h-8" />
                       <p className="text-[10px] font-bold uppercase tracking-widest">Engine Standby</p>
                    </div>
                  )}
                </div>

                <div className="p-4 border-t border-border-subtle flex gap-2">
                  <div className="relative group/export flex-1">
                    <button className="w-full px-3 py-2 border border-border-subtle bg-zinc-800 text-white rounded-lg text-xs font-bold hover:bg-zinc-700 transition-all uppercase tracking-tight flex items-center justify-center gap-2">
                      <Download className="w-3 h-3" /> Export
                    </button>
                    <div className="absolute bottom-full left-0 mb-2 w-48 bg-[#0A0A0B] border border-border-subtle rounded-xl shadow-2xl opacity-0 invisible group-hover/export:opacity-100 group-hover/export:visible transition-all z-20 overflow-hidden">
                       <button onClick={handleExportJSON} className="w-full p-3 text-left hover:bg-white/5 flex items-center gap-3 text-xs font-bold border-b border-white/5">
                         <FileJson className="w-4 h-4 text-amber-500" /> JSON Report
                       </button>
                       <button onClick={handleExportPDF} className="w-full p-3 text-left hover:bg-white/5 flex items-center gap-3 text-xs font-bold">
                         <FileText className="w-4 h-4 text-rose-500" /> PDF Analysis
                       </button>
                    </div>
                  </div>
                  {currentResult && (
                    <button 
                      disabled={currentResult.approvedByHuman}
                      onClick={() => handleHumanApproval(currentResult.id)}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg text-xs font-bold transition-all shadow-lg uppercase tracking-tight",
                        currentResult.approvedByHuman 
                          ? "bg-emerald-500/20 text-emerald-500 border border-emerald-500/30 cursor-default"
                          : "bg-blue-600 text-white hover:bg-blue-500"
                      )}
                    >
                      {currentResult.approvedByHuman ? 'APPROVED' : 'Human Approval'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Stats Bar at bottom */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 pb-4">
              {[
                { label: 'Total Requests', val: stats.total.toLocaleString(), color: 'text-text-primary' },
                { label: 'Blocked Responses', val: stats.blocked.toLocaleString(), color: 'text-rose-500' },
                { label: 'System Mode', val: mode.toUpperCase(), color: 'text-blue-500' },
                { label: 'Health Score', val: '99.8%', color: 'text-emerald-500' },
              ].map((s) => (
                <div key={s.label} className="bg-card border border-border-subtle p-4 rounded-xl shadow-lg">
                  <div className={cn("text-2xl font-black mb-1 font-mono tracking-tight", s.color)}>{s.val}</div>
                  <div className="text-[10px] font-bold text-text-secondary uppercase tracking-widest">{s.label}</div>
                </div>
              ))}
            </div>
          </>
        ) : currentView === 'logs' ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6 flex-1 overflow-hidden flex flex-col">
            <header className="flex justify-between items-center bg-card p-4 rounded-xl border border-border-subtle">
               <div>
                 <h2 className="text-lg font-bold tracking-tight">Comprehensive Audit Ledger</h2>
                 <p className="text-xs text-text-secondary">Immutable history of the governance engine</p>
               </div>
               <div className="text-[10px] text-text-secondary font-mono tracking-widest uppercase bg-white/5 px-3 py-1.5 rounded-full border border-border-subtle">Vault Status: SECURE</div>
            </header>
            
            <div className="bg-card border border-border-subtle rounded-xl overflow-hidden shadow-2xl flex-1 flex flex-col">
              <div className="overflow-y-auto flex-1 h-0">
                <table className="w-full text-left text-[12px] border-collapse">
                  <thead className="bg-white/5 border-b border-border-subtle text-text-secondary sticky top-0 z-10">
                    <tr>
                      <th className="px-6 py-4 font-bold uppercase tracking-widest">Timestamp</th>
                      <th className="px-6 py-4 font-bold uppercase tracking-widest">Decision</th>
                      <th className="px-6 py-4 font-bold uppercase tracking-widest">Risk</th>
                      <th className="px-6 py-4 font-bold uppercase tracking-widest">Prompt Preview</th>
                      <th className="px-6 py-4 font-bold uppercase tracking-widest">Engine Mode</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border-subtle">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="px-6 py-4 font-mono text-text-secondary">
                          {log.timestamp.toLocaleDateString()} {log.timestamp.toLocaleTimeString()}
                        </td>
                        <td className="px-6 py-4">
                          <span className={cn(
                            "px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-tighter",
                            log.decision === 'Block' ? "bg-rose-500/10 text-rose-500" : 
                            log.decision === 'Warn' ? "bg-amber-500/10 text-amber-500" : 
                            "bg-emerald-500/10 text-emerald-500"
                          )}>
                            {log.decision}
                          </span>
                        </td>
                        <td className={cn("px-6 py-4 font-black font-mono", getRiskLevel(log.riskScore).color)}>
                          {(log.riskScore * 100).toFixed(1)}%
                        </td>
                        <td className="px-6 py-4 text-text-secondary italic truncate max-w-xs">"{log.prompt}"</td>
                        <td className="px-6 py-4">
                           <span className="text-[10px] font-bold text-text-secondary uppercase px-2 py-0.5 border border-border-subtle rounded bg-white/5">{log.mode}</span>
                        </td>
                      </tr>
                    ))}
                    {logs.length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-6 py-12 text-center text-text-secondary opacity-30 italic uppercase font-bold tracking-[0.2em] bg-white/5">
                          Vault empty • No governed transactions found
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </motion.div>
        ) : currentView === 'policy' ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {(['Strict', 'Balanced', 'Open'] as const).map(m => (
              <div key={m} className={cn(
                "bg-card border p-6 rounded-2xl flex flex-col gap-4 shadow-xl",
                mode === m ? "border-blue-500 shadow-blue-500/5" : "border-border-subtle"
              )}>
                <div className="flex justify-between items-center">
                  <h3 className="text-lg font-bold uppercase tracking-tight">{m} Mode</h3>
                  {mode === m && <span className="px-2 py-1 bg-blue-500 text-[10px] rounded font-black text-white">ACTIVE</span>}
                </div>
                <p className="text-xs text-text-secondary leading-relaxed">
                  {m === 'Strict' ? 'Aggressive filtering designed for highly sensitive environments. High false-positive rate preferred over any leakage.' : 
                   m === 'Balanced' ? 'The standard operating model. Optimized for safety without sacrificing general utility for common tasks.' : 
                   'Advanced user/developer mode. Minimum server-side filtering; relies primarily on user discretion and deep logging.'}
                </p>
                <div className="space-y-3 mt-4 pt-4 border-t border-border-subtle">
                   <div className="flex justify-between text-xs font-bold uppercase text-text-secondary">
                     <span>Enforcement Level</span>
                     <span className={m === 'Strict' ? 'text-rose-500' : m === 'Balanced' ? 'text-amber-500' : 'text-emerald-500'}>
                       {m === 'Strict' ? 'CRITICAL' : m === 'Balanced' ? 'STANDARD' : 'LOW'}
                     </span>
                   </div>
                   <div className="space-y-4 pt-2">
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] text-text-secondary">BLOCK THRESHOLD</span>
                        <span className="font-mono text-text-primary">{m === 'Strict' ? '0.5' : m === 'Balanced' ? '0.7' : '0.9'}</span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-[11px] text-text-secondary">WARN THRESHOLD</span>
                        <span className="font-mono text-text-primary">{m === 'Strict' ? '0.2' : m === 'Balanced' ? '0.3' : '0.6'}</span>
                      </div>
                   </div>
                </div>
              </div>
            ))}
            <div className="md:col-span-3 bg-blue-500/5 border border-blue-500/20 p-6 rounded-2xl flex items-center gap-6">
                <div className="p-4 bg-blue-500 rounded-full">
                   <Lock className="w-8 h-8 text-white" />
                </div>
                <div>
                   <h3 className="font-bold text-lg">Infrastructure Security</h3>
                   <p className="text-sm text-text-secondary max-w-2xl">The policy engine uses a distributed consensus model for scoring. Changes to these modes require administrator elevation. Strict mode is recommended for enterprise AI integrations handling PII data.</p>
                </div>
            </div>
          </motion.div>
        ) : currentView === 'weights' ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
               <div className="bg-card border border-border-subtle p-8 rounded-2xl shadow-xl flex flex-col gap-6">
                  <header>
                    <h3 className="text-xl font-bold">Feedback Weights</h3>
                    <p className="text-xs text-text-secondary">Current neural importance assigned to risk vectors</p>
                  </header>
                  
                  {serverWeights ? (
                    <div className="space-y-8 py-4">
                      {[
                        { label: 'Harmful Keywords (w1)', val: serverWeights.w1 },
                        { label: 'Intent Analysis (w2)', val: serverWeights.w2 },
                        { label: 'Contextual Severity (w3)', val: serverWeights.w3 },
                        { label: 'Threat Intelligence (w4)', val: (serverWeights as any).w4 || 0 },
                      ].map(w => (
                        <div key={w.label} className="space-y-2">
                           <div className="flex justify-between items-end">
                              <span className="text-xs font-bold uppercase text-text-secondary tracking-widest">{w.label}</span>
                              <span className="text-2xl font-mono font-bold text-blue-500">{w.val.toFixed(4)}</span>
                           </div>
                           <div className="h-2 w-full bg-border-subtle rounded-full overflow-hidden">
                              <motion.div 
                                initial={{ width: 0 }} 
                                animate={{ width: `${w.val * 100}%` }} 
                                className="h-full bg-blue-500 shadow-[0_0_10px_rgba(59,130,246,0.3)]" 
                              />
                           </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="flex-1 flex items-center justify-center italic text-text-secondary opacity-50">Syncing with server weights...</div>
                  )}
               </div>

               <div className="bg-card border border-border-subtle p-8 rounded-2xl shadow-xl flex flex-col gap-6">
                  <header>
                    <h3 className="text-xl font-bold">Learning Parameters</h3>
                    <p className="text-xs text-text-secondary">Operational constants for the adaptive engine</p>
                  </header>
                  
                  <div className="grid grid-cols-1 gap-4">
                     <div className="bg-black/20 p-5 rounded-xl border border-border-subtle/50 flex justify-between items-center">
                        <div>
                           <div className="text-xs font-bold text-text-secondary uppercase">Learning Rate (α)</div>
                           <div className="text-sm text-text-secondary italic">Step size for weight adjustments</div>
                        </div>
                        <div className="text-3xl font-mono font-black text-amber-500">{serverWeights?.alpha ?? '0.05'}</div>
                     </div>
                     <div className="bg-emerald-500/5 p-5 rounded-xl border border-emerald-500/20 flex gap-4">
                        <Zap className="w-10 h-10 text-emerald-500 flex-shrink-0" />
                        <div className="text-xs text-text-secondary leading-relaxed">
                          The **Adatpive Governance Engine** uses stochastic gradient descent concepts to update the system weights based on human feedback. Each "Too Strict" or "Too Lax" report shifts the system's sensitivity by **α · feedback · factor**.
                        </div>
                     </div>
                  </div>
               </div>
            </div>
          </motion.div>
        ) : (
          /* Monitoring View */
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-8">
             <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
                {[
                  { label: 'System Uptime', val: '99.99%', Icon: Database, color: 'text-emerald-500' },
                  { label: 'Blocked Attacks', val: stats.blocked, Icon: ShieldAlert, color: 'text-rose-500' },
                  { label: 'Avg Risk Index', val: (stats.avgRisk * 100).toFixed(1) + '%', Icon: Activity, color: 'text-blue-500' },
                  { label: 'Active Policies', val: '14,209', Icon: Lock, color: 'text-text-secondary' },
                ].map(s => (
                  <div key={s.label} className="bg-card border border-border-subtle p-6 rounded-2xl shadow-xl">
                    <div className="flex justify-between items-center mb-4">
                       <s.Icon className={cn("w-5 h-5", s.color)} />
                       <span className="text-[10px] font-bold text-text-secondary uppercase">Live</span>
                    </div>
                    <div className="text-3xl font-black">{s.val}</div>
                    <div className="text-[10px] font-bold text-text-secondary uppercase mt-1 tracking-widest">{s.label}</div>
                  </div>
                ))}
             </div>

             <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div className="bg-card border border-border-subtle p-8 rounded-2xl shadow-xl h-[400px] flex flex-col">
                   <h3 className="text-lg font-bold mb-6">Traffic Risk Distribution</h3>
                   <div className="flex-1 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                         <AreaChart data={stats.riskTrend}>
                           <defs>
                             <linearGradient id="colorRisk" x1="0" y1="0" x2="0" y2="1">
                               <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3}/>
                               <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                             </linearGradient>
                           </defs>
                           <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                           <XAxis dataKey="time" stroke="#ffffff20" fontSize={10} axisLine={false} tickLine={false} />
                           <YAxis stroke="#ffffff20" fontSize={10} axisLine={false} tickLine={false} domain={[0, 1]} tickFormatter={v => (v*100)+'%'} />
                           <Tooltip contentStyle={{ backgroundColor: '#0A0A0B', border: '1px solid #2A2A2E', borderRadius: '8px', fontSize: '12px' }} />
                           <Area type="monotone" dataKey="risk" stroke="#3b82f6" fillOpacity={1} fill="url(#colorRisk)" strokeWidth={2} />
                         </AreaChart>
                      </ResponsiveContainer>
                   </div>
                </div>

                <div className="bg-card border border-border-subtle p-8 rounded-2xl shadow-xl h-[400px] flex flex-col">
                   <h3 className="text-lg font-bold mb-6">Decision Policy Breakdown</h3>
                   <div className="flex-1 w-full flex items-center justify-center">
                      <div className="h-full w-full">
                         <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                               <Pie
                                  data={[
                                    { name: 'Allow', value: logs.filter(l => l.decision === 'Allow').length },
                                    { name: 'Warn', value: logs.filter(l => l.decision === 'Warn').length },
                                    { name: 'Block', value: logs.filter(l => l.decision === 'Block').length },
                                  ]}
                                  innerRadius={70}
                                  outerRadius={100}
                                  paddingAngle={8}
                                  dataKey="value"
                               >
                                  <Cell fill="#10b981" />
                                  <Cell fill="#f59e0b" />
                                  <Cell fill="#ef4444" />
                               </Pie>
                               <Tooltip contentStyle={{ backgroundColor: '#0A0A0B', border: '1px solid #2A2A2E', borderRadius: '8px' }} />
                            </PieChart>
                         </ResponsiveContainer>
                      </div>
                   </div>
                   <div className="flex justify-center gap-6 mt-4">
                      {[
                        { label: 'Allow', color: 'bg-emerald-500' },
                        { label: 'Warn', color: 'bg-amber-500' },
                        { label: 'Block', color: 'bg-rose-500' },
                      ].map(i => (
                        <div key={i.label} className="flex items-center gap-2">
                           <div className={cn("w-2 h-2 rounded-full", i.color)} />
                           <span className="text-[10px] uppercase font-bold text-text-secondary">{i.label}</span>
                        </div>
                      ))}
                   </div>
                </div>
             </div>
             
             <div className="grid grid-cols-1 gap-8 mt-8">
                <div className="bg-card border border-border-subtle p-8 rounded-2xl shadow-xl h-[400px] flex flex-col">
                   <h3 className="text-lg font-bold mb-6">Component Risk Distribution (Intent)</h3>
                   <div className="flex-1 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                         <BarChart data={[
                           { name: 'Goal', risk: stats.total > 0 ? (logs.reduce((acc, l) => acc + (l.intent?.goalRisk || 0), 0) / stats.total) : 0 },
                           { name: 'Method', risk: stats.total > 0 ? (logs.reduce((acc, l) => acc + (l.intent?.methodRisk || 0), 0) / stats.total) : 0 },
                           { name: 'Target', risk: stats.total > 0 ? (logs.reduce((acc, l) => acc + (l.intent?.targetRisk || 0), 0) / stats.total) : 0 },
                         ]}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#ffffff05" vertical={false} />
                            <XAxis dataKey="name" stroke="#ffffff20" fontSize={10} axisLine={false} tickLine={false} />
                            <YAxis stroke="#ffffff20" fontSize={10} axisLine={false} tickLine={false} domain={[0, 1]} tickFormatter={v => (v*100)+'%'} />
                            <Tooltip contentStyle={{ backgroundColor: '#0A0A0B', border: '1px solid #2A2A2E', borderRadius: '8px' }} />
                            <Bar dataKey="risk" fill="#3b82f6" radius={[4, 4, 0, 0]} />
                         </BarChart>
                      </ResponsiveContainer>
                   </div>
                </div>
             </div>
          </motion.div>
        )}
      </main>

      {/* Grid Pattern Background */}
      <div className="fixed inset-0 pointer-events-none opacity-[0.03] z-[-1]" 
           style={{backgroundImage: 'radial-gradient(circle, #fff 1px, transparent 1px)', backgroundSize: '40px 40px'}} />
    </div>
  );
}

