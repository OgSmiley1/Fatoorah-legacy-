import React from 'react';
import { Merchant } from '../types';
import {
  Mail, Phone, MessageCircle, Shield, TrendingUp,
  Copy, CheckCircle2, Loader2,
  Globe, Zap, Github, Facebook, MapPin,
  Send, Instagram, Save, AlertTriangle, Award, BarChart3, ExternalLink
} from 'lucide-react';
import { telegramService } from '../services/telegramService';
import { motion, AnimatePresence } from 'motion/react';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface MerchantCardProps {
  merchant: Merchant;
  onSave?: (merchant: Merchant) => void;
  isSaved?: boolean;
  showStatus?: boolean;
  onStatusChange?: (id: string, status: any) => void;
}

export const MerchantCard: React.FC<MerchantCardProps> = ({
  merchant,
  onSave,
  isSaved,
  showStatus,
  onStatusChange
}) => {
  const [showScripts, setShowScripts] = React.useState(false);
  const [showBreakdown, setShowBreakdown] = React.useState(false);
  const [copied, setCopied] = React.useState<string | null>(null);
  const [tgSending, setTgSending] = React.useState(false);
  const [ghUpdates, setGhUpdates] = React.useState<any[]>([]);
  const [loadingGh, setLoadingGh] = React.useState(false);

  const fetchGithubUpdates = async () => {
    if (!merchant.githubUrl) return;
    setLoadingGh(true);
    try {
      const parts = merchant.githubUrl.replace('https://github.com/', '').split('/');
      if (parts.length >= 2) {
        const response = await fetch(`https://api.github.com/repos/${parts[0]}/${parts[1]}/commits?per_page=3`);
        if (response.ok) setGhUpdates(await response.json());
      }
    } catch (error) {
      console.error('Failed to fetch GitHub updates:', error);
    } finally {
      setLoadingGh(false);
    }
  };

  const copyToClipboard = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 2000);
  };

  const handleSendTelegram = async () => {
    const token = localStorage.getItem('sw_tg_token');
    const chatId = localStorage.getItem('sw_tg_chatid');
    if (!token || !chatId) { alert('Please configure Telegram in the dashboard first.'); return; }
    setTgSending(true);
    const ok = await telegramService.sendMessage(token, chatId, merchant);
    setTgSending(false);
    if (ok) { setCopied('tg'); setTimeout(() => setCopied(null), 2000); }
    else alert('Failed to send to Telegram. Check your bot configuration.');
  };

  const openWhatsApp = () => {
    if (!merchant.whatsapp && !merchant.phone) return;
    const phone = (merchant.whatsapp || merchant.phone).replace(/\D/g, '');
    const arabicMsg = encodeURIComponent(
      `مرحباً ${merchant.businessName}، لاحظنا متجركم المميز على ${merchant.platform}. نحن في ماي فاتورة نقدم حلول دفع إلكتروني متكاملة تشمل الدفع عند الاستلام، بوابات دفع عالمية، وروابط دفع مباشرة. هل تودون معرفة المزيد؟`
    );
    window.open(`https://wa.me/${phone}?text=${arabicMsg}`, '_blank');
  };

  const openWhatsAppEnglish = () => {
    if (!merchant.whatsapp && !merchant.phone) return;
    const phone = (merchant.whatsapp || merchant.phone).replace(/\D/g, '');
    const msg = encodeURIComponent(
      `Hi ${merchant.businessName}, I noticed your store on ${merchant.platform}. At MyFatoorah, we provide seamless payment solutions including COD support, payment links, and global gateways. Would you like to learn more?`
    );
    window.open(`https://wa.me/${phone}?text=${msg}`, '_blank');
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return "text-emerald-400";
    if (score >= 50) return "text-amber-400";
    return "text-rose-400";
  };

  const getGradeColor = (grade?: string) => {
    if (grade === 'A') return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    if (grade === 'B') return "bg-blue-500/20 text-blue-400 border-blue-500/30";
    if (grade === 'C') return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    return "bg-rose-500/20 text-rose-400 border-rose-500/30";
  };

  const getVerificationColor = (status?: string) => {
    if (status === 'VERIFIED') return "bg-emerald-500/10 text-emerald-400 border-emerald-500/20";
    if (status === 'PARTIALLY_VERIFIED') return "bg-blue-500/10 text-blue-400 border-blue-500/20";
    return "bg-slate-800 text-slate-400 border-slate-700";
  };

  const verificationStatus = merchant.verification?.status || merchant.contactValidation?.status || 'UNVERIFIED';
  const compositeScore = merchant.qualityScore || 0;
  const grade = merchant.evaluationGrade;

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn(
        "mission-control-card overflow-hidden group border-l-4",
        merchant.status === 'DUPLICATE' ? "border-l-slate-700 opacity-60" :
        compositeScore >= 70 ? "border-l-emerald-500" :
        compositeScore >= 45 ? "border-l-amber-500" : "border-l-slate-800"
      )}
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex justify-between items-start mb-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <h3 className="text-xl font-bold text-slate-100 truncate">{merchant.businessName}</h3>
              {merchant.status === 'DUPLICATE' && (
                <span className="bg-slate-800 text-slate-400 text-[9px] font-bold px-2 py-0.5 rounded-full border border-slate-700 uppercase">Duplicate</span>
              )}
              {merchant.isCOD && (
                <span className="bg-amber-500/10 text-amber-400 text-[9px] font-bold px-2 py-0.5 rounded-full border border-amber-500/20 uppercase tracking-wider animate-pulse">COD</span>
              )}
              {grade && (
                <span className={cn("text-[10px] font-black px-2.5 py-0.5 rounded-full border uppercase", getGradeColor(grade))}>
                  Grade {grade}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
              {merchant.instagramHandle && (
                <a href={`https://instagram.com/${merchant.instagramHandle}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-pink-400 transition-colors">
                  <Instagram size={12} className="text-pink-500" /> @{merchant.instagramHandle}
                </a>
              )}
              {merchant.category && (
                <span className="flex items-center gap-1"><Zap size={10} className="text-blue-400" /> {merchant.category}</span>
              )}
              {merchant.dulNumber && (
                <span className="flex items-center gap-1 text-amber-400"><Shield size={12} /> DUL: {merchant.dulNumber}</span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-1.5 ml-3">
            <div className="flex gap-1.5">
              <div className={cn("px-2 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-1 border uppercase tracking-wider", getVerificationColor(verificationStatus))}>
                {verificationStatus === 'VERIFIED' ? <CheckCircle2 size={10} /> : verificationStatus === 'PARTIALLY_VERIFIED' ? <Shield size={10} /> : <AlertTriangle size={10} />}
                {verificationStatus.replace('_', ' ')}
                {merchant.verification?.sourcesConfirmed ? ` (${merchant.verification.sourcesConfirmed} src)` : ''}
              </div>
              <div className={cn(
                "px-2 py-0.5 rounded-full text-[9px] font-bold flex items-center gap-1 border uppercase",
                merchant.risk?.category === 'LOW' ? "bg-emerald-500/10 text-emerald-400 border-emerald-500/20" :
                merchant.risk?.category === 'MEDIUM' ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                "bg-red-500/10 text-red-400 border-red-500/20"
              )}>
                {merchant.risk?.emoji || '🛡️'} {merchant.risk?.category || 'LOW'}
              </div>
            </div>
            {merchant.duplicateReason && (
              <span className="text-[8px] text-slate-500 font-bold uppercase">{merchant.duplicateReason}</span>
            )}
          </div>
        </div>

        {/* Composite Score + Grade */}
        <div className="flex items-center gap-4 mb-4 p-3 bg-slate-950/50 rounded-xl border border-slate-800/50">
          <div className="text-center min-w-[60px]">
            <p className={cn("text-3xl font-black", getScoreColor(compositeScore))}>{compositeScore}</p>
            <p className="text-[8px] font-bold text-slate-500 uppercase tracking-widest">Score</p>
          </div>
          <div className="flex-1 min-w-0">
            {merchant.evaluationRecommendation && (
              <p className="text-[10px] text-slate-300 leading-relaxed truncate">{merchant.evaluationRecommendation}</p>
            )}
            <button
              onClick={() => setShowBreakdown(!showBreakdown)}
              className="text-[9px] font-bold text-blue-400 hover:text-blue-300 uppercase tracking-wider mt-1 flex items-center gap-1"
            >
              <BarChart3 size={10} /> {showBreakdown ? 'Hide' : 'Show'} Breakdown
            </button>
          </div>
        </div>

        {/* Score Breakdown */}
        <AnimatePresence>
          {showBreakdown && merchant.evaluationBreakdown && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="mb-4 overflow-hidden">
              <div className="grid grid-cols-3 gap-2">
                {Object.entries(merchant.evaluationBreakdown).map(([key, val]) => (
                  <div key={key} className="bg-slate-950/50 p-2 rounded-lg border border-slate-800/50 text-center">
                    <p className="text-[8px] font-bold text-slate-500 uppercase tracking-wider mb-0.5">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </p>
                    <p className={cn("text-sm font-black", getScoreColor((val as any).score * 20))}>
                      {((val as any).score as number).toFixed(1)}<span className="text-[8px] text-slate-600">/5</span>
                    </p>
                    <p className="text-[7px] text-slate-600 font-bold">{((val as any).weight * 100).toFixed(0)}% weight</p>
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Risk Assessment Factors */}
        {merchant.risk?.factors && merchant.risk.factors.length > 0 && (
          <div className="mb-4">
            <div className="flex flex-wrap gap-1.5">
              {merchant.risk.factors.map((factor, i) => (
                <span key={i} className={cn(
                  "text-[8px] font-bold px-2 py-0.5 rounded-full border uppercase tracking-tighter",
                  factor.includes('COD') ? "bg-amber-500/10 text-amber-400 border-amber-500/20" :
                  "bg-rose-500/10 text-rose-400 border-rose-500/20"
                )}>
                  {factor.includes('COD') ? '💰' : '⚠️'} {factor}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Revenue & Pricing */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/50">
            <p className="mission-control-label mb-1 flex items-center gap-1"><TrendingUp size={10} /> Est. Revenue</p>
            <p className="text-sm font-bold text-slate-100">AED {merchant.revenue?.monthly?.toLocaleString() || '0'}/mo</p>
            <p className="text-[9px] text-slate-500 uppercase">AED {merchant.revenue?.annual?.toLocaleString() || '0'}/yr</p>
          </div>
          <div className="bg-slate-950/50 p-3 rounded-xl border border-slate-800/50">
            <p className="mission-control-label mb-1 flex items-center gap-1"><Zap size={10} /> MyFatoorah Offer</p>
            <p className="text-sm font-bold text-emerald-400">
              {merchant.pricing?.setupFee === 0 ? 'FREE SETUP' : `AED ${merchant.pricing?.setupFee} SETUP`}
            </p>
            <p className="text-[9px] text-slate-500 uppercase">{merchant.pricing?.transactionRate} • {merchant.pricing?.settlementCycle}</p>
          </div>
        </div>

        {/* Payment Gateway + Location */}
        <div className="grid grid-cols-2 gap-3 mb-4">
          <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-800/50 flex items-center gap-2">
            <Shield size={12} className="text-blue-400 flex-shrink-0" />
            <span className="text-xs text-slate-300 truncate">{merchant.paymentGateway || 'No gateway detected'}</span>
          </div>
          {(merchant.physicalAddress || merchant.location) && (
            <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-800/50 flex items-center gap-2">
              <MapPin size={12} className="text-rose-400 flex-shrink-0" />
              <span className="text-xs text-slate-300 truncate">{merchant.physicalAddress || merchant.location}</span>
            </div>
          )}
        </div>

        {/* Contact Details — Clickable */}
        <div className="mb-4 space-y-1.5">
          <h4 className="mission-control-label">Contact Routes</h4>
          <div className="grid grid-cols-1 gap-1.5">
            {(merchant.whatsapp || merchant.phone) && (
              <div className="flex items-center justify-between text-xs text-slate-300 bg-emerald-500/5 p-2 rounded-lg border border-emerald-500/10">
                <a href={`https://wa.me/${(merchant.whatsapp || merchant.phone).replace(/\D/g, '')}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 hover:text-emerald-400 transition-colors">
                  <MessageCircle size={12} className="text-emerald-500" />
                  <span>{merchant.whatsapp || merchant.phone}</span>
                  <ExternalLink size={10} className="opacity-50" />
                </a>
                <button onClick={() => copyToClipboard(merchant.whatsapp || merchant.phone, 'wa')} className="text-emerald-500 hover:text-emerald-400">
                  {copied === 'wa' ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                </button>
              </div>
            )}
            {merchant.phone && merchant.phone !== merchant.whatsapp && (
              <div className="flex items-center justify-between text-xs text-slate-300 bg-slate-950/30 p-2 rounded-lg border border-slate-800/50">
                <a href={`tel:${merchant.phone}`} className="flex items-center gap-2 hover:text-blue-400 transition-colors">
                  <Phone size={12} className="text-blue-400" />
                  <span>{merchant.phone}</span>
                </a>
                <button onClick={() => copyToClipboard(merchant.phone, 'ph')} className="text-slate-500 hover:text-slate-400">
                  {copied === 'ph' ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                </button>
              </div>
            )}
            {merchant.email && (
              <div className="flex items-center justify-between text-xs text-slate-300 bg-slate-950/30 p-2 rounded-lg border border-slate-800/50">
                <a href={`mailto:${merchant.email}`} className="flex items-center gap-2 hover:text-blue-400 transition-colors">
                  <Mail size={12} className="text-blue-400" />
                  <span className="truncate max-w-[200px]">{merchant.email}</span>
                </a>
                <button onClick={() => copyToClipboard(merchant.email, 'em')} className="text-slate-500 hover:text-slate-400">
                  {copied === 'em' ? <CheckCircle2 size={12} /> : <Copy size={12} />}
                </button>
              </div>
            )}
            {merchant.facebookUrl && (
              <div className="flex items-center text-xs text-slate-300 bg-slate-950/30 p-2 rounded-lg border border-slate-800/50">
                <a href={merchant.facebookUrl.startsWith('http') ? merchant.facebookUrl : `https://facebook.com/${merchant.facebookUrl}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 hover:text-blue-400 transition-colors">
                  <Facebook size={12} className="text-blue-600" />
                  <span className="truncate max-w-[200px]">{merchant.facebookUrl}</span>
                  <ExternalLink size={10} className="opacity-50" />
                </a>
              </div>
            )}
            {merchant.tiktokHandle && (
              <div className="flex items-center text-xs text-slate-300 bg-slate-950/30 p-2 rounded-lg border border-slate-800/50">
                <a href={`https://tiktok.com/@${merchant.tiktokHandle}`} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-2 hover:text-slate-100 transition-colors">
                  <Zap size={12} className="text-slate-100" />
                  <span>@{merchant.tiktokHandle}</span>
                  <ExternalLink size={10} className="opacity-50" />
                </a>
              </div>
            )}
          </div>
        </div>

        {/* Evidence Sources */}
        {merchant.evidence && merchant.evidence.length > 0 && (
          <div className="mb-4">
            <h4 className="mission-control-label mb-1.5">Evidence Source</h4>
            <div className="flex flex-wrap gap-2">
              {merchant.evidence.map((source, i) => (
                <a key={i} href={source.uri} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[9px] font-bold text-blue-400 bg-blue-500/10 px-2 py-1 rounded-lg border border-blue-500/20 hover:bg-blue-500/20 transition-all">
                  <Globe size={10} /> {source.title}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* GitHub Updates */}
        {merchant.githubUrl && (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="mission-control-label flex items-center gap-1.5"><Github size={12} className="text-slate-400" /> GitHub Intelligence</h4>
              {!loadingGh && ghUpdates.length === 0 && (
                <button onClick={fetchGithubUpdates} className="text-[9px] font-bold text-blue-400 hover:text-blue-300 uppercase">Fetch</button>
              )}
              {loadingGh && <Loader2 size={10} className="animate-spin text-slate-500" />}
            </div>
            <div className="bg-slate-950/50 rounded-xl border border-slate-800/50 p-3 space-y-2">
              {ghUpdates.length > 0 ? ghUpdates.map((commit, i) => (
                <div key={i} className="flex flex-col gap-0.5 border-b border-slate-800/30 last:border-0 pb-2 last:pb-0">
                  <p className="text-[10px] text-slate-300 line-clamp-1 font-mono">{commit.commit.message}</p>
                  <div className="flex items-center justify-between text-[8px] text-slate-500 uppercase tracking-tighter">
                    <span>{commit.commit.author.name}</span>
                    <span>{new Date(commit.commit.author.date).toLocaleDateString()}</span>
                  </div>
                </div>
              )) : (
                <p className="text-[10px] text-slate-500 italic">{loadingGh ? "Fetching..." : "Click 'Fetch' for latest commits."}</p>
              )}
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-2">
          {showStatus ? (
            <select
              value={merchant.status}
              onChange={(e) => onStatusChange?.(merchant.id, e.target.value)}
              className="flex-1 mission-control-input text-[10px] font-bold uppercase h-10"
            >
              <option value="NEW">New</option>
              <option value="CONTACTED">Contacted</option>
              <option value="QUALIFIED">Qualified</option>
              <option value="ONBOARDED">Onboarded</option>
              <option value="REJECTED">Rejected</option>
              <option value="ARCHIVED">Archived</option>
            </select>
          ) : (
            <>
              <button onClick={() => setShowScripts(!showScripts)}
                className="flex-1 mission-control-button mission-control-button-secondary text-[10px]">
                <MessageCircle size={14} /> Scripts
              </button>
              <button onClick={() => onSave?.(merchant)} disabled={isSaved || merchant.status === 'DUPLICATE'}
                className={cn("flex-1 mission-control-button text-[10px]",
                  isSaved ? "bg-emerald-500/20 text-emerald-400 border-emerald-500/30" : "mission-control-button-primary")}>
                {isSaved ? <CheckCircle2 size={14} /> : <Save size={14} />}
                <span>{isSaved ? "Saved" : "Save Lead"}</span>
              </button>
            </>
          )}

          {/* WhatsApp Arabic Outreach Button */}
          <button onClick={openWhatsApp} disabled={!merchant.whatsapp && !merchant.phone}
            className={cn("mission-control-button h-10 px-3",
              !merchant.whatsapp && !merchant.phone ? "opacity-50 cursor-not-allowed" : "bg-emerald-600/20 text-emerald-400 border-emerald-600/30 hover:bg-emerald-600/30")}
            title="WhatsApp Arabic Outreach">
            <MessageCircle size={14} />
            <span className="text-[9px] font-bold">AR</span>
          </button>

          {/* WhatsApp English Outreach Button */}
          <button onClick={openWhatsAppEnglish} disabled={!merchant.whatsapp && !merchant.phone}
            className={cn("mission-control-button h-10 px-3",
              !merchant.whatsapp && !merchant.phone ? "opacity-50 cursor-not-allowed" : "mission-control-button-secondary text-emerald-500")}
            title="WhatsApp English Outreach">
            <MessageCircle size={14} />
            <span className="text-[9px] font-bold">EN</span>
          </button>

          {/* Telegram */}
          <button onClick={handleSendTelegram} disabled={tgSending}
            className={cn("mission-control-button w-10 h-10",
              copied === 'tg' ? "bg-blue-500 text-white" : "mission-control-button-secondary")}>
            {tgSending ? <Loader2 className="animate-spin" size={16} /> :
             copied === 'tg' ? <CheckCircle2 size={16} /> : <Send size={16} />}
          </button>
        </div>

        {/* Expandable Scripts Section */}
        <AnimatePresence>
          {showScripts && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }} className="mt-4 overflow-hidden">
              <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-4">
                <div>
                  <div className="flex justify-between items-center mb-2">
                    <h5 className="mission-control-label">WhatsApp (Arabic)</h5>
                    <button onClick={() => copyToClipboard(merchant.scripts?.arabic || '', 'ar')} className="text-blue-400 hover:text-blue-300">
                      {copied === 'ar' ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed text-right" dir="rtl">
                    {merchant.scripts?.arabic || 'No script available.'}
                  </p>
                </div>
                <div className="pt-4 border-t border-slate-800">
                  <div className="flex justify-between items-center mb-2">
                    <h5 className="mission-control-label">WhatsApp (English)</h5>
                    <button onClick={() => copyToClipboard(merchant.scripts?.english || '', 'en')} className="text-blue-400 hover:text-blue-300">
                      {copied === 'en' ? <CheckCircle2 size={14} /> : <Copy size={14} />}
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {merchant.scripts?.english || 'No script available.'}
                  </p>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
