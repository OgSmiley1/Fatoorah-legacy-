  const clearAllHistory = () => {
    if (window.confirm('Are you sure you want to clear all history?')) {
      clearSearchHistory();
      setMerchants([]);
      refreshStats();
    }
  };

  const autoSendHunterResultsToTelegram = (merchantResults: Merchant[]) => {
    const autoSend = localStorage.getItem('sw_tg_autosend') === 'true';

    if (!autoSend || merchantResults.length === 0) return;

    const tgToken = localStorage.getItem('sw_tg_token');
    const tgChatId = localStorage.getItem('sw_tg_chatid');

    if (!tgToken || !tgChatId) return;

    setTgStatus('sending');

    merchantResults.forEach((merchant, idx) => {
      setTimeout(() => {
        telegramService
          .sendMessage(tgToken, tgChatId, merchant)
          .then((ok) => {
            if (!ok) {
              setTgStatus('error');
              setTimeout(() => setTgStatus('idle'), 3000);
              return;
            }

            if (idx === merchantResults.length - 1) {
              setTgStatus('success');
              setTimeout(() => setTgStatus('idle'), 2000);
            }
          })
          .catch(() => {
            setTgStatus('error');
            setTimeout(() => setTgStatus('idle'), 3000);
          });
      }, idx * 500);
    });
  };

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col">
      {/* Header */}
      <header className="border-b border-slate-800 bg-slate-900/50 backdrop-blur-xl sticky top-0 z-30">
        <div className="max-w-[1600px] mx-auto px-6 h-20 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20">
              <Zap className="text-white" size={24} />
            </div>
            <div>
              <h1 className="text-xl font-black text-white tracking-tight uppercase">MyFatoorah</h1>
              <p className="text-[10px] font-bold text-slate-500 tracking-[0.2em] uppercase">Acquisition Engine</p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <button
              onClick={() => setShowTelegram(true)}
              className={cn(
                "mission-control-button mission-control-button-secondary",
                tgStatus === 'sending' && "animate-pulse border-blue-500 text-blue-400"
              )}
            >
              <Send size={18} />
              <span className="hidden sm:inline">Telegram Ops</span>
            </button>

            <button
              onClick={() => setShowWhatsApp(true)}
              className="mission-control-button mission-control-button-secondary"
            >
              <MessageCircle size={18} />
              <span className="hidden sm:inline">WhatsApp</span>
            </button>

            <button
              onClick={() => setShowCardScanner(true)}
              className="mission-control-button mission-control-button-secondary"
            >
              <ScanLine size={18} />
              <span className="hidden sm:inline">Scan Card</span>
            </button>

            <button
              onClick={() => setShowPaymentLinkHunter(true)}
              className="mission-control-button mission-control-button-secondary"
              title="Hunt for payment link clients"
            >
              <TrendingUp size={18} />
              <span className="hidden sm:inline">Payment Links</span>
            </button>

            <button
              onClick={() => setShowPOSHunter(true)}
              className="mission-control-button mission-control-button-secondary"
              title="Hunt for POS clients"
            >
              <ShoppingCart size={18} />
              <span className="hidden sm:inline">POS Systems</span>
            </button>

            <div className="hidden md:flex items-center gap-6 px-6 border-x border-slate-800">
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Total Found</p>
                <p className="text-lg font-black text-white">{stats.total}</p>
              </div>
              <div className="text-center">
                <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-1">Qualified Leads</p>
                <p className="text-lg font-black text-emerald-400">{stats.leads}</p>
              </div>
            </div>

            <button
              onClick={() => exportMerchantsToExcel(merchants.length > 0 ? merchants : savedLeads)}
              disabled={merchants.length === 0 && savedLeads.length === 0}
              className="mission-control-button mission-control-button-primary"
            >
              <Download size={18} />
              <span className="hidden sm:inline">Export Pipeline</span>
            </button>

            <a
              href="/api/export/merchants.csv"
              className="mission-control-button mission-control-button-secondary"
              title="Apify-style dataset export — CSV of every merchant in the database"
            >
              <Download size={18} />
              <span className="hidden sm:inline">Dataset CSV</span>
            </a>
          </div>
        </div>
      </header>

      <div className="flex-1 flex overflow-hidden">
        <aside
          className={cn(
            "w-80 border-r border-slate-800 bg-slate-900/30 overflow-y-auto transition-all duration-300 hidden lg:block",
            !showFilters && "-ml-80"
          )}
        >
          <div className="p-6 space-y-8">
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <h3 className="mission-control-label">Lead Qualification</h3>
                <button
                  onClick={() =>
                    setParams({
                      ...params,
                      categories: [],
                      subCategories: [],
                      businessAge: undefined,
                      riskLevel: undefined,
                      minFollowers: undefined,
                    })
                  }
                  className="text-[10px] font-bold text-slate-500 hover:text-rose-500 uppercase transition-colors"
                >
                  Reset
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Target Categories</label>
                  <div className="flex flex-wrap gap-1.5">
                    {['Fashion', 'Abayas', 'Jewelry', 'Perfumes', 'Home Decor', 'Electronics', 'Food', 'Beauty'].map(cat => (
                      <button
                        key={cat}
                        onClick={() => toggleCategory(cat)}
                        className={cn(
                          "px-2 py-1 rounded-md text-[9px] font-bold border transition-all",
                          params.categories.includes(cat)
                            ? "bg-blue-500/20 border-blue-500/50 text-blue-400"
                            : "bg-slate-950/50 border-slate-800 text-slate-500 hover:border-slate-700"
                        )}
                      >
                        {cat}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Niche Focus</label>
                  <div className="space-y-2">
                    <div className="relative">
                      <Filter className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                      <input
                        type="text"
                        value={subInput}
                        onChange={e => setSubInput(e.target.value)}
                        onKeyDown={addSubCategory}
                        className="mission-control-input w-full pl-9"
                        placeholder="Type & Enter (e.g. Luxury)"
                      />
                    </div>

                    {params.subCategories.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {params.subCategories.map(sub => (
                          <span
                            key={sub}
                            className="flex items-center gap-1 px-2 py-0.5 rounded bg-slate-800 text-[9px] text-slate-300 border border-slate-700"
                          >
                            {sub}
                            <button onClick={() => removeSubCategory(sub)} className="hover:text-rose-500">
                              <X size={10} />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold text-slate-500 uppercase">Min Followers</label>
                  <div className="relative">
                    <TrendingUp className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={14} />
                    <input
                      type="number"
                      value={params.minFollowers || ''}
                      onChange={e => setParams({ ...params, minFollowers: parseInt(e.target.value) || undefined })}
                      className="mission-control-input w-full pl-9"
                      placeholder="e.g. 1000"
                    />
                  </div>
                </div>

                <label className="flex items-center gap-2 text-[11px] font-bold text-slate-300 uppercase cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={params.onlyQualified ?? true}
                    onChange={e => setParams({ ...params, onlyQualified: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-700 bg-slate-950 text-emerald-500 focus:ring-emerald-500/50"
                  />
                  <span>
                    MyFatoorah-ready only{' '}
                    <span className="text-slate-500 font-normal normal-case">
                      (drops merchants with Stripe/Tap/PayTabs)
                    </span>
                  </span>
                </label>
              </div>
            </div>

            <div className="space-y-4">
              <h3 className="mission-control-label">Discovery Channels</h3>
              <div className="grid grid-cols-2 gap-2">
                {Object.entries(params.platforms).map(([key, value]) => (
                  <button
                    key={key}
                    onClick={() =>
                      setParams({
                        ...params,
                        platforms: { ...params.platforms, [key]: !value },
                      })
                    }
                    className={cn(
                      "flex items-center gap-2 px-3 py-2 rounded-lg border text-[10px] font-bold uppercase transition-all",
                      value
                        ? "bg-blue-600/10 border-blue-600/50 text-blue-400"
                        : "bg-slate-950/50 border-slate-800 text-slate-500 hover:border-slate-700"
                    )}
                  >
                    <div className={cn("w-1.5 h-1.5 rounded-full", value ? "bg-blue-400" : "bg-slate-700")} />
                    {key}
                  </button>
                ))}
              </div>
            </div>

            {searchHistory.length > 0 && (
              <div className="space-y-4">
                <div className="flex justify-between items-center">
                  <h3 className="mission-control-label">Recent Hunts</h3>
                  <button onClick={clearAllHistory} className="text-slate-600 hover:text-rose-500 transition-colors">
                    <Trash2 size={12} />
                  </button>
                </div>

                <div className="space-y-2">
                  {searchHistory.map((h) => (
                    <button
                      key={h.id}
                      onClick={() => setParams({ ...params, keywords: h.query, location: h.location })}
                      className="w-full text-left p-3 rounded-xl bg-slate-950/50 border border-slate-800 hover:border-slate-700 transition-all group"
                    >
                      <div className="flex justify-between items-start mb-1">
                        <p className="text-[11px] font-bold text-slate-200 truncate pr-2">{h.query}</p>
                        <ChevronRight size={10} className="text-slate-600 group-hover:text-blue-400 transition-colors" />
                      </div>
                      <div className="flex items-center gap-2 text-[9px] text-slate-500 font-bold uppercase">
                        <span>{h.location}</span>
                        <span>•</span>
                        <span>{h.resultsCount} Leads</span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </aside>

        <main className="flex-1 overflow-y-auto bg-slate-950 p-6">
          <div className="max-w-[1200px] mx-auto space-y-6">
            <div className="flex items-center gap-1 bg-slate-900/50 p-1 rounded-lg border border-slate-800 mb-6 w-fit">
              <button
                onClick={() => setActiveTab('hunt')}
                className={cn(
                  "px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all",
                  activeTab === 'hunt' ? "bg-blue-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                )}
              >
                Lead Hunter
              </button>

              <button
                onClick={() => setActiveTab('pipeline')}
                className={cn(
                  "px-4 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-widest transition-all",
                  activeTab === 'pipeline' ? "bg-blue-600 text-white shadow-lg" : "text-slate-500 hover:text-slate-300"
                )}
              >
                Sales Pipeline
              </button>
            </div>

            {activeTab === 'hunt' ? (
              <>
                <div className="mission-control-card p-4 bg-slate-900/80 backdrop-blur-md sticky top-0 z-20 border-blue-500/20 shadow-blue-900/10">
                  <div className="flex flex-col md:flex-row gap-3">
                    <div className="flex-1 relative">
                      <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" size={18} />
                      <input
                        type="text"
                        value={params.keywords}
                        onChange={e => setParams({ ...params, keywords: e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                        className="mission-control-input w-full pl-12 h-14 text-lg font-medium bg-slate-950/80 border-slate-800 focus:border-blue-500/50"
                        placeholder="Optional — leave empty to use sidebar filters"
                      />
                    </div>

                    <div className="w-full md:w-64 relative">
                      <MapPin className="absolute left-4 top-1/2 -translate-y-1/2 text-emerald-500" size={18} />
                      <input
                        type="text"
                        value={params.location}
                        onChange={e => setParams({ ...params, location: e.target.value })}
                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                        className="mission-control-input w-full pl-12 h-14 text-lg font-medium bg-slate-950/80 border-slate-800 focus:border-emerald-500/50"
                        placeholder="Location..."
                      />
                    </div>

                    <button
                      onClick={() => handleSearch()}
                      disabled={loading}
                      className="mission-control-button mission-control-button-primary h-14 px-8 text-lg group"
                    >
                      {loading ? (
                        <Loader2 className="animate-spin" size={24} />
                      ) : (
                        <Zap size={24} className="group-hover:scale-110 transition-transform" />
                      )}

                      <div className="flex flex-col items-start">
                        <span>{loading ? "Hunting..." : "Hunt Leads"}</span>
                        {loading && searchProgress && (
                          <span className="text-[10px] opacity-70">Found: {searchProgress.count}</span>
                        )}
                      </div>
                    </button>
                  </div>
                </div>

                {merchants.length === 0 && !loading ? (
                  <div className="h-[60vh] flex flex-col items-center justify-center text-center space-y-6">
                    <div className="w-20 h-20 bg-slate-900 rounded-3xl flex items-center justify-center border border-slate-800 shadow-2xl">
                      <Search size={40} className="text-slate-700" />
                    </div>
                    <div className="space-y-2">
                      <h2 className="text-2xl font-black text-white uppercase tracking-tight">Ready for Discovery</h2>
                      <p className="text-slate-500 max-w-sm mx-auto font-bold text-xs uppercase tracking-widest">
                        Enter keywords and location to start hunting for high-potential MyFatoorah merchants.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-2 gap-6 pb-20">
                    <AnimatePresence mode="popLayout">
                      {merchants.map((merchant, i) => (
                        <MerchantCard
                          key={`${merchant.id}-${i}`}
                          merchant={merchant}
                          onSave={handleSaveLead}
                          isSaved={savedLeads.some(l => l.id === merchant.id)}
                        />
                      ))}
                    </AnimatePresence>
                  </div>
                )}

                {loading && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {[1, 2, 3, 4].map(i => (
                      <div key={i} className="mission-control-card h-[400px] animate-pulse">
                        <div className="p-6 space-y-6">
                          <div className="flex justify-between">
                            <div className="w-1/2 h-6 bg-slate-800 rounded" />
                            <div className="w-20 h-6 bg-slate-800 rounded-full" />
                          </div>
                          <div className="grid grid-cols-3 gap-3">
                            {[1, 2, 3].map(j => (
                              <div key={j} className="h-16 bg-slate-800 rounded-xl" />
                            ))}
                          </div>
                          <div className="h-24 bg-slate-800 rounded-xl" />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            ) : (
              <PipelineView />
            )}
          </div>
        </main>
      </div>

      <footer className="h-10 border-t border-slate-800 bg-slate-900 flex items-center px-6 justify-between text-[10px] font-bold text-slate-500 uppercase tracking-widest">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
            Engine Online
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-blue-500" />
            Deduplication Active
          </div>
          <div className="flex items-center gap-1.5 border-l border-slate-800 pl-4">
            <Sparkles size={10} className="text-blue-400" />
            <span className="text-blue-400 font-bold">Multi-Engine Intelligence (Gemini + Web + InvestInDubai)</span>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span>{stats.total} Merchants in Database</span>
          <button onClick={clearAllHistory} className="hover:text-rose-500 transition-colors">
            Clear History
          </button>
        </div>
      </footer>

      <TelegramModal
        isOpen={showTelegram}
        onClose={() => setShowTelegram(false)}
        merchants={merchants}
        savedLeads={savedLeads}
      />

      <WhatsAppModal
        isOpen={showWhatsApp}
        onClose={() => setShowWhatsApp(false)}
      />

      <CardScannerModal
        isOpen={showCardScanner}
        onClose={() => setShowCardScanner(false)}
        onSaveLead={(cardData) => {
          const merchant = {
            businessName: cardData.company || cardData.name || 'Unknown',
            platform: 'website' as const,
            url: cardData.website || '',
            website: cardData.website || '',
            phone: cardData.phone || '',
            whatsapp: cardData.phone || '',
            email: cardData.email || '',
            category: 'Business Card Scan',
            physicalAddress: cardData.address || '',
          };

          geminiService
            .ingestMerchants([merchant as any], 'Business Card Scan', 'UAE')
            .then(() => {
              refreshStats();
              setShowCardScanner(false);
            })
            .catch(e => console.error('Failed to save card scan lead:', e));
        }}
      />

      <WizardChat
        onSearch={(keywords, location) => {
          setParams(prev => ({ ...prev, keywords, location }));
          handleSearch(keywords);
        }}
        onRefreshStats={refreshStats}
        onUpdateStatus={handleUpdateLead}
      />

      <AnimatePresence>
        {showPaymentLinkHunter && (
          <PaymentLinkHunter
            onResultsFound={(merchantResults) => {
              if (merchantResults.length > 0) {
                setMerchants(merchantResults);
                refreshStats();
                autoSendHunterResultsToTelegram(merchantResults);
              }
            }}
            onClose={() => setShowPaymentLinkHunter(false)}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showPOSHunter && (
          <POSHunter
            onResultsFound={(merchantResults) => {
              if (merchantResults.length > 0) {
                setMerchants(merchantResults);
                refreshStats();
                autoSendHunterResultsToTelegram(merchantResults);
              }
            }}
            onClose={() => setShowPOSHunter(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
};