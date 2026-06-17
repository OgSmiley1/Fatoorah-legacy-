import React, { useState } from 'react';
import { X, Calendar, Users, MessageSquare, TrendingUp } from 'lucide-react';

interface CRMModalProps {
  merchant: any;
  isOpen: boolean;
  onClose: () => void;
  onSave: (data: any) => void;
}

export const CRMModal: React.FC<CRMModalProps> = ({ merchant, isOpen, onClose, onSave }) => {
  const [data, setData] = useState({
    status: merchant?.status || 'NEW',
    proposal_status: merchant?.proposal_status || 'Not Sent',
    contacted_date: merchant?.contacted_date || '',
    next_followup: merchant?.next_followup || '',
    owner: merchant?.owner || '',
    expected_volume_aed: merchant?.expected_volume_aed || '',
    notes: merchant?.notes || '',
    followup_count: merchant?.followup_count || 0,
  });

  const handleChange = (field: string, value: any) => {
    setData(prev => ({ ...prev, [field]: value }));
  };

  const handleSave = () => {
    onSave(data);
    onClose();
  };

  // Calculate next action based on status and dates
  const getNextAction = () => {
    if (data.status === 'ONBOARDED') return '✅ Onboarded';
    if (data.status === 'REJECTED') return '⛔ Rejected';
    if (data.status === 'INTERESTED' && data.proposal_status === 'Not Sent') {
      return '📩 Send Proposal NOW';
    }
    if (data.status === 'NEW') return '📞 First Contact';
    if (data.next_followup && new Date(data.next_followup) <= new Date()) {
      return '⏰ Follow up TODAY';
    }
    if (data.next_followup) {
      const nextDate = new Date(data.next_followup).toLocaleDateString();
      return `📅 Scheduled ${nextDate}`;
    }
    return '→ Move forward';
  };

  // Estimate MF Revenue
  const estimatedRevenue = data.expected_volume_aed
    ? (parseInt(data.expected_volume_aed) * 12 * 0.025).toLocaleString()
    : '0';

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-slate-900 rounded-lg shadow-xl max-w-2xl w-full max-h-96 overflow-y-auto border border-slate-700">
        {/* Header */}
        <div className="flex justify-between items-center p-6 border-b border-slate-700 sticky top-0 bg-slate-900">
          <div>
            <h2 className="text-xl font-bold text-white">{merchant?.business_name}</h2>
            <p className="text-sm text-slate-400">{merchant?.category}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-white">
            <X size={24} />
          </button>
        </div>

        {/* Form */}
        <div className="p-6 space-y-4">
          {/* Status */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">Status</label>
            <select
              value={data.status}
              onChange={(e) => handleChange('status', e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="NEW">New</option>
              <option value="CONTACTED">Contacted</option>
              <option value="IN_PROGRESS">In Progress</option>
              <option value="INTERESTED">Interested</option>
              <option value="PROPOSAL_SENT">Proposal Sent</option>
              <option value="FOLLOW_UP">Follow Up</option>
              <option value="ONBOARDED">Onboarded</option>
              <option value="REJECTED">Rejected</option>
              <option value="NOT_QUALIFIED">Not Qualified</option>
            </select>
          </div>

          {/* Proposal Status */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">Proposal Status</label>
            <select
              value={data.proposal_status}
              onChange={(e) => handleChange('proposal_status', e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="Not Sent">Not Sent</option>
              <option value="Drafted">Drafted</option>
              <option value="Sent">Sent</option>
              <option value="Negotiating">Negotiating</option>
              <option value="Accepted">Accepted</option>
              <option value="Rejected">Rejected</option>
            </select>
          </div>

          {/* Contacted Date */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">📞 Contacted Date</label>
            <input
              type="date"
              value={data.contacted_date}
              onChange={(e) => handleChange('contacted_date', e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Next Follow-up */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">📅 Next Follow-up</label>
            <input
              type="date"
              value={data.next_followup}
              onChange={(e) => handleChange('next_followup', e.target.value)}
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Owner */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">Owner</label>
            <input
              type="text"
              value={data.owner}
              onChange={(e) => handleChange('owner', e.target.value)}
              placeholder="Assigned sales rep"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Expected Volume */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">💰 Expected Monthly Volume (AED)</label>
            <input
              type="number"
              value={data.expected_volume_aed}
              onChange={(e) => handleChange('expected_volume_aed', e.target.value)}
              placeholder="50,000"
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {data.expected_volume_aed && (
              <p className="text-xs text-slate-400 mt-1">
                Estimated MF Revenue: <strong>AED {estimatedRevenue}/year</strong>
              </p>
            )}
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-semibold text-slate-200 mb-2">📝 Notes</label>
            <textarea
              value={data.notes}
              onChange={(e) => handleChange('notes', e.target.value)}
              placeholder="Add notes about this lead..."
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              rows={3}
            />
          </div>

          {/* Next Action Summary */}
          <div className="bg-blue-500/10 border border-blue-500/30 rounded-lg p-3">
            <p className="text-sm text-blue-300">
              <strong>Next Action:</strong> {getNextAction()}
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex gap-2 p-6 border-t border-slate-700 bg-slate-950">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 rounded-lg border border-slate-700 text-slate-300 hover:bg-slate-800 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition font-semibold"
          >
            💾 Save
          </button>
        </div>
      </div>
    </div>
  );
};
