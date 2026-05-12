// src/components/ProposalModal.tsx
// Renders the server-built MyFatoorah proposal as a card-style preview.
// 10 sections on the left (cover → next steps), commercial-analysis panel
// on the right (tier + setup-fee bracket + rationale). Buttons to copy as
// text, open WhatsApp/email with the same content, or mark proposal-sent.

import React from 'react';
import { motion } from 'motion/react';
import { X, MessageCircle, Mail, Copy, CheckCircle2, FileText, BadgeCheck } from 'lucide-react';

// Mirrors server/templates/proposalBuilder.ts — kept as a plain interface here
// so the front-end doesn't pull in any server-only deps.
export interface ProposalPayload {
  merchantId: string;
  generatedAt: string;
  whatsappUrl: string | null;
  mailtoUrl: string | null;
  commercialAnalysis: {
    tier: 'Micro' | 'Small-Medium' | 'Medium-High' | 'High-Volume';
    setupFeeAed: { min: number; max: number; recommended: number };
    localRate: string;
    intlRate: string;
    settlement: string;
    rationale: string;
    upliftEstimate: { bnplPercent: number; cashflowDaysSaved: number };
  };
  sections: {
    cover: string;
    executiveSummary: string;
    aboutMyFatoorah: string;
    theirProblem: string;
    ourSolution: string;
    pricingTable: {
      setupFeeAed: number;
      localRate: string;
      intlRate: string;
      settlementFeeAed: number;
      settlement: string;
    };
    roiProjection: {
      monthlyVolumeAed: number;
      settlementUpliftAed: number;
      bnplUpliftAed: number;
      totalAnnualUpliftAed: number;
      cashflowDaysSaved: number;
    };
    timeline: string[];
    kycDocs: string[];
    nextSteps: string;
    signature: string;
  };
}

interface Props {
  proposal: ProposalPayload;
  merchantName: string;
  onClose: () => void;
}

function aed(n: number): string {
  return `AED ${Math.round(n).toLocaleString()}`;
}

function proposalAsText(p: ProposalPayload, merchantName: string): string {
  const s = p.sections;
  return [
    s.cover,
    '',
    '1. EXECUTIVE SUMMARY',
    s.executiveSummary,
    '',
    '2. ABOUT MYFATOORAH',
    s.aboutMyFatoorah,
    '',
    '3. YOUR CURRENT PROBLEM',
    s.theirProblem,
    '',
    '4. OUR SOLUTION',
    s.ourSolution,
    '',
    '5. PRICING',
    `Setup Fee (one-time): ${aed(s.pricingTable.setupFeeAed)}`,
    `Local card rate: ${s.pricingTable.localRate}  |  International: ${s.pricingTable.intlRate}`,
    `Settlement: ${s.pricingTable.settlement}  |  Settlement fee: ${aed(s.pricingTable.settlementFeeAed)} / weekly cycle`,
    '',
    '6. ROI PROJECTION',
    `Estimated monthly volume: ${aed(s.roiProjection.monthlyVolumeAed)}`,
    `Faster-settlement uplift: ${aed(s.roiProjection.settlementUpliftAed)} / month`,
    `BNPL uplift estimate: ${aed(s.roiProjection.bnplUpliftAed)} / month`,
    `Total annual uplift: ${aed(s.roiProjection.totalAnnualUpliftAed)}`,
    `Cashflow days saved: ${s.roiProjection.cashflowDaysSaved} per cycle`,
    '',
    '7. IMPLEMENTATION TIMELINE',
    ...s.timeline,
    '',
    '8. KYC DOCUMENTS REQUIRED',
    ...s.kycDocs.map((d, i) => `${i + 1}. ${d}`),
    '',
    '9. NEXT STEPS',
    s.nextSteps,
    '',
    '—',
    s.signature,
  ].join('\n');
}

export const ProposalModal: React.FC<Props> = ({ proposal, merchantName, onClose }) => {
  const [copied, setCopied] = React.useState(false);
  const [sent, setSent] = React.useState(false);
  const [sending, setSending] = React.useState(false);
  const s = proposal.sections;
  const ca = proposal.commercialAnalysis;

  const onCopy = () => {
    navigator.clipboard.writeText(proposalAsText(proposal, merchantName));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const onMarkSent = async () => {
    // The merchant id is the proposal target; we mark all leads pointing at it.
    // The server route only operates on /api/leads/:id, so the caller should
    // pass a lead id when wiring later; for now we no-op gracefully if absent.
    setSending(true);
    try {
      await fetch(`/api/leads/${encodeURIComponent(proposal.merchantId)}/proposal-sent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ proposal_url: null }),
      });
      setSent(true);
    } catch { /* best-effort */ }
    finally { setSending(false); }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.95, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.95, y: 12 }}
        className="bg-slate-950 border border-slate-800 rounded-2xl w-full max-w-5xl max-h-[90vh] overflow-hidden flex flex-col md:flex-row"
        onClick={(e) => e.stopPropagation()}
      >
        {/* LEFT — proposal body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-emerald-400 text-[11px] font-bold tracking-widest uppercase mb-1">
                <FileText size={14} /> MyFatoorah Proposal
              </div>
              <h2 className="text-xl font-bold text-white">{merchantName}</h2>
              <p className="text-xs text-slate-500 mt-1">{new Date(proposal.generatedAt).toLocaleString()}</p>
            </div>
            <button onClick={onClose} className="text-slate-500 hover:text-white">
              <X size={20} />
            </button>
          </div>

          <Section title="1. Executive Summary" body={s.executiveSummary} />
          <Section title="2. About MyFatoorah" body={s.aboutMyFatoorah} />
          <Section title="3. Your Current Problem" body={s.theirProblem} />
          <Section title="4. Our Solution" body={s.ourSolution} />

          <div>
            <h3 className="text-sm font-bold text-white mb-2">5. Pricing</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Kv label="Setup Fee (one-time)" value={aed(s.pricingTable.setupFeeAed)} highlight />
              <Kv label="Local card rate" value={s.pricingTable.localRate} />
              <Kv label="International" value={s.pricingTable.intlRate} />
              <Kv label="Settlement" value={s.pricingTable.settlement} />
              <Kv label="Settlement fee" value={`${aed(s.pricingTable.settlementFeeAed)} / weekly cycle`} />
              <Kv label="Per-transaction" value="AED 1.00" />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-white mb-2">6. ROI Projection</h3>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <Kv label="Est. monthly volume" value={aed(s.roiProjection.monthlyVolumeAed)} />
              <Kv label="Faster-settlement uplift / mo" value={aed(s.roiProjection.settlementUpliftAed)} />
              <Kv label="BNPL uplift / mo" value={aed(s.roiProjection.bnplUpliftAed)} />
              <Kv label="Total annual uplift" value={aed(s.roiProjection.totalAnnualUpliftAed)} highlight />
              <Kv label="Cashflow days saved" value={`${s.roiProjection.cashflowDaysSaved} per cycle`} />
            </div>
          </div>

          <div>
            <h3 className="text-sm font-bold text-white mb-2">7. Implementation Timeline</h3>
            <ol className="list-decimal list-inside text-xs text-slate-300 space-y-1">
              {s.timeline.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </div>

          <div>
            <h3 className="text-sm font-bold text-white mb-2">8. KYC Documents Required</h3>
            <ul className="text-xs text-slate-300 grid grid-cols-1 gap-1">
              {s.kycDocs.map((d, i) => (
                <li key={i} className="flex items-center gap-2"><BadgeCheck className="text-emerald-500 shrink-0" size={14} /> {d}</li>
              ))}
            </ul>
          </div>

          <Section title="9. Next Steps" body={s.nextSteps} />

          <div className="text-xs text-slate-400 whitespace-pre-line border-t border-slate-800 pt-4">
            {s.signature}
          </div>
        </div>

        {/* RIGHT — commercial analysis panel */}
        <div className="md:w-80 bg-slate-900 border-l border-slate-800 p-5 flex flex-col gap-4 overflow-y-auto">
          <div>
            <div className="text-[10px] font-bold tracking-widest uppercase text-amber-400 mb-2">
              Commercial Analysis
            </div>
            <div className="text-3xl font-bold text-white">{ca.tier}</div>
            <p className="text-xs text-slate-400 mt-1">Recommended pricing tier</p>
          </div>

          <div className="bg-slate-950 border border-slate-800 rounded-xl p-3">
            <div className="text-[10px] uppercase tracking-wider text-slate-500">Setup fee</div>
            <div className="text-2xl font-bold text-emerald-400 mt-1">{aed(ca.setupFeeAed.recommended)}</div>
            <div className="text-[11px] text-slate-500 mt-1">
              Band: {aed(ca.setupFeeAed.min)} – {aed(ca.setupFeeAed.max)}
            </div>
          </div>

          <div className="text-xs text-slate-300 leading-relaxed">
            <strong className="text-white">Why this tier?</strong>
            <p className="mt-1">{ca.rationale}</p>
          </div>

          <div className="text-xs space-y-1.5 text-slate-300">
            <div className="flex justify-between"><span>Local rate</span><span className="text-white">{ca.localRate}</span></div>
            <div className="flex justify-between"><span>International rate</span><span className="text-white">{ca.intlRate}</span></div>
            <div className="flex justify-between"><span>Settlement</span><span className="text-white">{ca.settlement}</span></div>
            <div className="flex justify-between"><span>BNPL uplift estimate</span><span className="text-white">+{ca.upliftEstimate.bnplPercent}%</span></div>
            <div className="flex justify-between"><span>Cashflow days saved</span><span className="text-white">{ca.upliftEstimate.cashflowDaysSaved}</span></div>
          </div>

          <div className="flex flex-col gap-2 mt-auto pt-3">
            <button
              onClick={onCopy}
              className="mission-control-button mission-control-button-secondary text-xs justify-center"
            >
              {copied ? <CheckCircle2 size={14} className="text-emerald-500" /> : <Copy size={14} />}
              {copied ? 'Copied' : 'Copy as text'}
            </button>
            {proposal.whatsappUrl && (
              <a
                href={proposal.whatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mission-control-button mission-control-button-secondary text-xs justify-center text-emerald-500"
              >
                <MessageCircle size={14} /> Open WhatsApp
              </a>
            )}
            {proposal.mailtoUrl && (
              <a
                href={proposal.mailtoUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="mission-control-button mission-control-button-secondary text-xs justify-center text-blue-400"
              >
                <Mail size={14} /> Open Email
              </a>
            )}
            <button
              onClick={onMarkSent}
              disabled={sent || sending}
              className="mission-control-button mission-control-button-primary text-xs justify-center"
            >
              {sent ? <><CheckCircle2 size={14} /> Marked sent</> : sending ? 'Saving…' : 'Mark proposal sent'}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

function Section({ title, body }: { title: string; body: string }) {
  return (
    <div>
      <h3 className="text-sm font-bold text-white mb-2">{title}</h3>
      <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{body}</p>
    </div>
  );
}

function Kv({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`p-2 rounded-lg ${highlight ? 'bg-emerald-500/10 border border-emerald-500/30' : 'bg-slate-900 border border-slate-800'}`}>
      <div className="text-[10px] uppercase tracking-wider text-slate-500">{label}</div>
      <div className={`text-xs font-semibold mt-0.5 ${highlight ? 'text-emerald-400' : 'text-white'}`}>{value}</div>
    </div>
  );
}
