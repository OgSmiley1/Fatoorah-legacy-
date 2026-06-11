import React, { useState, useEffect } from 'react';
import { Mail, MessageCircle, Download, Copy, Search, X } from 'lucide-react';

interface Merchant {
  id: string;
  business_name: string;
  category?: string;
  phone?: string;
  email?: string;
  website?: string;
  instagram_handle?: string;
  score?: number;
  priority?: string;
}

interface ProposalData {
  merchantName: string;
  sector: string;
  phone: string;
  email: string;
  setupFee: number;
  services: string[];
  expectedMonthlyVolume: number;
}

export default function ProposalBuilder() {
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [selectedMerchant, setSelectedMerchant] = useState<Merchant | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [showSearch, setShowSearch] = useState(true);
  const [proposal, setProposal] = useState<ProposalData>({
    merchantName: '',
    sector: '',
    phone: '',
    email: '',
    setupFee: 0,
    services: ['Payment Links', 'WhatsApp Integration', 'Invoice Generation'],
    expectedMonthlyVolume: 0,
  });

  useEffect(() => {
    fetchMerchants();
  }, []);

  useEffect(() => {
    if (selectedMerchant) {
      setProposal({
        merchantName: selectedMerchant.business_name || '',
        sector: selectedMerchant.category || '',
        phone: selectedMerchant.phone || '',
        email: selectedMerchant.email || '',
        setupFee: 0,
        services: ['Payment Links', 'WhatsApp Integration', 'Invoice Generation'],
        expectedMonthlyVolume: 0,
      });
      setShowSearch = false;
    }
  }, [selectedMerchant]);

  const fetchMerchants = async () => {
    try {
      const response = await fetch('/api/merchants?limit=50&sort=score');
      const data = await response.json();
      setMerchants(data.merchants || []);
    } catch (error) {
      console.error('Failed to fetch merchants:', error);
    }
  };

  const filteredMerchants = merchants.filter(m =>
    m.business_name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    m.category?.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const sectorHook = getSectorHook(proposal.sector);
  const estimatedRevenue = estimateRevenue(proposal.expectedMonthlyVolume);

  const emailContent = generateEmailProposal(proposal, sectorHook, estimatedRevenue);
  const whatsappContent = generateWhatsAppProposal(proposal, sectorHook);

  const handleSave = async () => {
    if (!selectedMerchant) return;

    try {
      const response = await fetch(`/api/merchants/${selectedMerchant.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          expected_volume_aed: proposal.expectedMonthlyVolume,
          setup_fee: proposal.setupFee,
        }),
      });

      if (response.ok) {
        alert('Proposal saved!');
      }
    } catch (error) {
      console.error('Failed to save:', error);
    }
  };

  const handleCopyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    alert('Copied to clipboard!');
  };

  if (showSearch && merchants.length > 0) {
    return (
      <div className="max-w-2xl mx-auto p-6 bg-white rounded-lg shadow">
        <h2 className="text-2xl font-bold mb-6">🎯 Generate Proposal</h2>

        {/* Search Bar */}
        <div className="relative mb-6">
          <Search className="absolute left-3 top-3 text-gray-400" size={20} />
          <input
            type="text"
            placeholder="Search merchants by name or sector..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>

        {/* Merchant List */}
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredMerchants.length > 0 ? (
            filteredMerchants.map((merchant) => (
              <button
                key={merchant.id}
                onClick={() => setSelectedMerchant(merchant)}
                className="w-full text-left p-4 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-500 transition"
              >
                <div className="flex justify-between items-start">
                  <div>
                    <h3 className="font-semibold text-gray-800">{merchant.business_name}</h3>
                    <p className="text-sm text-gray-600">{merchant.category || 'Uncategorized'}</p>
                  </div>
                  {merchant.priority && (
                    <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                      merchant.priority === 'HOT' ? 'bg-red-100 text-red-800' :
                      merchant.priority === 'WARM' ? 'bg-orange-100 text-orange-800' :
                      'bg-gray-100 text-gray-800'
                    }`}>
                      {merchant.priority}
                    </span>
                  )}
                </div>
              </button>
            ))
          ) : (
            <p className="text-center text-gray-500 py-8">No merchants found</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6">
      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-bold">📋 Proposal Generator</h1>
        <button
          onClick={() => {
            setSelectedMerchant(null);
            setSearchTerm('');
            setShowSearch(true);
          }}
          className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
        >
          <Search size={18} /> Change Merchant
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Form Section */}
        <div className="bg-white p-8 rounded-lg shadow">
          <h2 className="text-xl font-bold mb-6">Business Details</h2>

          {selectedMerchant && (
            <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
              <h3 className="font-semibold text-blue-900">{selectedMerchant.business_name}</h3>
              <p className="text-sm text-blue-700">{selectedMerchant.category}</p>
              {selectedMerchant.phone && <p className="text-sm text-blue-700">📱 {selectedMerchant.phone}</p>}
              {selectedMerchant.email && <p className="text-sm text-blue-700">✉️ {selectedMerchant.email}</p>}
            </div>
          )}

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Setup Fee (AED)</label>
              <input
                type="number"
                value={proposal.setupFee}
                onChange={(e) => setProposal({ ...proposal, setupFee: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0"
              />
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Expected Monthly Volume (AED)</label>
              <input
                type="number"
                value={proposal.expectedMonthlyVolume}
                onChange={(e) => setProposal({ ...proposal, expectedMonthlyVolume: parseInt(e.target.value) || 0 })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="50,000"
              />
              {proposal.expectedMonthlyVolume > 0 && (
                <p className="text-sm text-gray-600 mt-2">
                  📊 Estimated MF Revenue: <strong>AED {estimatedRevenue.toLocaleString()}/year</strong>
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Services</label>
              <div className="space-y-2">
                {['Payment Links', 'WhatsApp Integration', 'Invoice Generation', 'BNPL Financing', 'Settlement Reports'].map((service) => (
                  <label key={service} className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={proposal.services.includes(service)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setProposal({ ...proposal, services: [...proposal.services, service] });
                        } else {
                          setProposal({ ...proposal, services: proposal.services.filter(s => s !== service) });
                        }
                      }}
                      className="rounded"
                    />
                    <span className="text-gray-700">{service}</span>
                  </label>
                ))}
              </div>
            </div>

            <button
              onClick={handleSave}
              className="w-full bg-blue-600 text-white py-3 rounded-lg font-semibold hover:bg-blue-700 transition mt-6"
            >
              💾 Save Proposal
            </button>
          </div>
        </div>

        {/* Proposal Preview Section */}
        <div className="space-y-6">
          {/* Email Proposal Card */}
          <div className="bg-white p-8 rounded-lg shadow border-l-4 border-blue-600">
            <div className="flex items-center gap-2 mb-4">
              <Mail size={24} className="text-blue-600" />
              <h3 className="text-lg font-bold">Email Proposal</h3>
            </div>

            <div className="mb-4 p-4 bg-gray-50 rounded border border-gray-200 max-h-64 overflow-y-auto text-sm font-mono">
              <p className="font-semibold text-gray-800 mb-2">Subject:</p>
              <p className="mb-4 text-gray-700">{getEmailSubject(proposal)}</p>
              <p className="font-semibold text-gray-800 mb-2">Body Preview:</p>
              <p className="text-gray-700 whitespace-pre-wrap">{emailContent.substring(0, 300)}...</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleCopyToClipboard(emailContent)}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-50 text-blue-600 py-2 rounded-lg hover:bg-blue-100 transition font-semibold"
              >
                <Copy size={18} /> Copy
              </button>
              <button
                onClick={() => window.location.href = `mailto:${proposal.email}?subject=${encodeURIComponent(getEmailSubject(proposal))}&body=${encodeURIComponent(emailContent)}`}
                className="flex-1 flex items-center justify-center gap-2 bg-blue-600 text-white py-2 rounded-lg hover:bg-blue-700 transition font-semibold"
              >
                <Mail size={18} /> Send
              </button>
            </div>
          </div>

          {/* WhatsApp Proposal Card */}
          <div className="bg-white p-8 rounded-lg shadow border-l-4 border-green-600">
            <div className="flex items-center gap-2 mb-4">
              <MessageCircle size={24} className="text-green-600" />
              <h3 className="text-lg font-bold">WhatsApp Message</h3>
            </div>

            <div className="mb-4 p-4 bg-gray-50 rounded border border-gray-200 max-h-64 overflow-y-auto text-sm">
              <p className="text-gray-700 whitespace-pre-wrap">{whatsappContent.substring(0, 250)}...</p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => handleCopyToClipboard(whatsappContent)}
                className="flex-1 flex items-center justify-center gap-2 bg-green-50 text-green-600 py-2 rounded-lg hover:bg-green-100 transition font-semibold"
              >
                <Copy size={18} /> Copy
              </button>
              <button
                onClick={() => {
                  const cleanPhone = proposal.phone.replace(/\D/g, '');
                  const waLink = `https://wa.me/971${cleanPhone.slice(-9)}?text=${encodeURIComponent(whatsappContent)}`;
                  window.open(waLink, '_blank');
                }}
                className="flex-1 flex items-center justify-center gap-2 bg-green-600 text-white py-2 rounded-lg hover:bg-green-700 transition font-semibold"
              >
                <MessageCircle size={18} /> Send
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper functions
function getSectorHook(sector: string): string {
  const sectorLower = sector?.toLowerCase() || '';

  if (sectorLower.includes('real estate') || sectorLower.includes('property')) {
    return 'high-net-worth GCC buyers expect secure checkout — MyFatoorah protects your margins on high-ticket transactions';
  } else if (sectorLower.includes('car wash') || sectorLower.includes('automotive')) {
    return 'repeat customers — payment links turn washes into recurring revenue. WhatsApp settlements in 24hrs';
  } else if (sectorLower.includes('salon') || sectorLower.includes('spa')) {
    return 'WhatsApp bookings deserve a checkout that matches your brand. No payment gateway upcharge';
  } else if (sectorLower.includes('catering') || sectorLower.includes('food')) {
    return 'Instagram orders close faster with a one-click payment link. Real-time settlement dashboard';
  }
  return 'your customers expect the same checkout experience as global platforms';
}

function estimateRevenue(monthlyVolume: number): number {
  if (!monthlyVolume) return 0;
  return monthlyVolume * 12 * 0.025; // 2.5% transaction fee
}

function getEmailSubject(proposal: ProposalData): string {
  return `MyFatoorah x ${proposal.merchantName} — Payment Collection, Pricing & Next Steps`;
}

function generateEmailProposal(proposal: ProposalData, hook: string, revenue: number): string {
  return `Dear ${proposal.merchantName} Team,

Based on your activity in ${proposal.sector.toLowerCase()}, ${hook}.

PROPOSED SETUP
Setup Fee: AED ${proposal.setupFee}
Transaction Fee: 2.5% per transaction
Settlement: T+1 (Next business day)
Estimated Annual Revenue (at AED ${proposal.expectedMonthlyVolume.toLocaleString()}/month): AED ${revenue.toLocaleString()}

SERVICES INCLUDED
${proposal.services.map(s => `• ${s}`).join('\n')}

NEXT STEPS
1. Review proposal and confirm services
2. Schedule onboarding call (30 mins)
3. Go live within 48 hours

For questions, reach out to:
M. Sharif | Commercial Manager
MyFatoorah PSP LLC
📱 +971 4 XXX XXXX
📧 sales@myfatoorah.ae`;
}

function generateWhatsAppProposal(proposal: ProposalData, hook: string): string {
  return `السلام عليكم ${proposal.merchantName}، 👋

أنا معاذ من ماي فاتورة. ${hook}

🔗 رابط الدفع + WhatsApp Integration
💰 عمولة 2.5% فقط
⏱️ التسويات في 24 ساعة

هل متاح لك تقصير سريع حول الحل؟`;
}
