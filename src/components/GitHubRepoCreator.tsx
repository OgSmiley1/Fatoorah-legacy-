import React, { useState, useEffect } from 'react';
import { Github, Plus, ExternalLink, LogOut, Loader2, CheckCircle2, AlertCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

export const GitHubRepoCreator: React.FC = () => {
  const [status, setStatus] = useState<{ connected: boolean; user: string | null }>({ connected: false, user: null });
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [repoName, setRepoName] = useState('');
  const [repoDesc, setRepoDesc] = useState('Smiley Wizard Merchant Intelligence Repository');
  const [isPrivate, setIsPrivate] = useState(true);
  const [result, setResult] = useState<{ success: boolean; message: string; url?: string } | null>(null);

  const checkStatus = async () => {
    try {
      const res = await fetch('/api/github/status');
      const data = await res.json();
      setStatus(data);
    } catch (e) {
      console.error('Failed to check GitHub status', e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    checkStatus();

    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'OAUTH_AUTH_SUCCESS' && event.data?.provider === 'github') {
        checkStatus();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);

  const handleConnect = async () => {
    try {
      const res = await fetch('/api/auth/github/url');
      const { url } = await res.json();
      window.open(url, 'github_oauth', 'width=600,height=700');
    } catch (e) {
      console.error('Failed to get auth URL', e);
    }
  };

  const handleLogout = async () => {
    await fetch('/api/github/logout', { method: 'POST' });
    setStatus({ connected: false, user: null });
  };

  const handleCreateRepo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!repoName) return;

    setCreating(true);
    setResult(null);

    try {
      const res = await fetch('/api/github/create-repo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: repoName, description: repoDesc, isPrivate })
      });

      const data = await res.json();
      if (data.success) {
        setResult({ success: true, message: `Repository "${data.repo.name}" created!`, url: data.repo.html_url });
        setRepoName('');
      } else {
        setResult({ success: false, message: data.error || 'Failed to create repository' });
      }
    } catch (e) {
      setResult({ success: false, message: 'Network error' });
    } finally {
      setCreating(false);
    }
  };

  if (loading) return <div className="p-4 flex justify-center"><Loader2 className="animate-spin text-slate-500" /></div>;

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-6 backdrop-blur-sm">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-800 flex items-center justify-center">
            <Github className="w-6 h-6 text-white" />
          </div>
          <div>
            <h3 className="text-white font-bold">GitHub Integration</h3>
            <p className="text-xs text-slate-400">Export leads to your GitHub repositories</p>
          </div>
        </div>
        
        {status.connected ? (
          <div className="flex items-center gap-3">
            <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Connected as {status.user}
            </span>
            <button 
              onClick={handleLogout}
              className="p-2 hover:bg-rose-500/10 hover:text-rose-500 text-slate-400 rounded-lg transition-colors"
              title="Logout"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button 
            onClick={handleConnect}
            className="px-4 py-2 bg-white text-black text-xs font-bold rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2"
          >
            <Github className="w-4 h-4" /> Connect GitHub
          </button>
        )}
      </div>

      {status.connected && (
        <form onSubmit={handleCreateRepo} className="space-y-4">
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Repository Name</label>
            <input 
              type="text" 
              value={repoName}
              onChange={(e) => setRepoName(e.target.value)}
              placeholder="e.g. merchant-leads-2024"
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
              required
            />
          </div>
          
          <div>
            <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1.5">Description (Optional)</label>
            <input 
              type="text" 
              value={repoDesc}
              onChange={(e) => setRepoDesc(e.target.value)}
              className="w-full bg-slate-950 border border-slate-800 rounded-lg px-4 py-2.5 text-sm text-white focus:outline-none focus:border-blue-500 transition-colors"
            />
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer group">
              <input 
                type="checkbox" 
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
                className="sr-only"
              />
              <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${isPrivate ? 'bg-blue-500 border-blue-500' : 'border-slate-700 group-hover:border-slate-500'}`}>
                {isPrivate && <div className="w-2 h-2 bg-white rounded-full" />}
              </div>
              <span className="text-xs text-slate-300">Private Repository</span>
            </label>
          </div>

          <button 
            type="submit"
            disabled={creating || !repoName}
            className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-2"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Create Repository
          </button>

          <AnimatePresence>
            {result && (
              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className={`p-4 rounded-lg flex items-start gap-3 ${result.success ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-400' : 'bg-rose-500/10 border border-rose-500/20 text-rose-400'}`}
              >
                {result.success ? <CheckCircle2 className="w-5 h-5 shrink-0" /> : <AlertCircle className="w-5 h-5 shrink-0" />}
                <div className="flex-1">
                  <p className="text-sm font-medium">{result.message}</p>
                  {result.url && (
                    <a 
                      href={result.url} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-xs underline mt-1 flex items-center gap-1 hover:text-emerald-300"
                    >
                      View on GitHub <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </form>
      )}

      {!status.connected && (
        <div className="text-center py-8 border-2 border-dashed border-slate-800 rounded-xl">
          <Github className="w-12 h-12 text-slate-700 mx-auto mb-3" />
          <p className="text-sm text-slate-500 max-w-[200px] mx-auto">Connect your GitHub account to start creating repositories directly from the dashboard.</p>
        </div>
      )}
    </div>
  );
};
