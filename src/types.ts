export type RiskCategory = 'LOW' | 'MEDIUM' | 'HIGH';
export type LeadStatus = 'NEW' | 'CONTACTED' | 'FOLLOW_UP' | 'INTERESTED' | 'MEETING' | 'QUALIFIED' | 'NOT_QUALIFIED' | 'REJECTED' | 'ONBOARDED' | 'ARCHIVED';
export type ContactConfidence = 'VERIFIED' | 'LIKELY' | 'WEAK' | 'MISSING';

export interface EvidenceSource {
  type: string;
  title: string;
  uri: string;
}

export interface Merchant {
  id: string;
  business_name: string;
  platform: string;
  url: string;
  maps_place_id?: string;
  instagram_handle?: string;
  tiktok_handle?: string;
  telegram_handle?: string;
  category: string;
  sub_category?: string;
  followers: number;
  bio: string;
  email: string;
  phone: string;
  whatsapp: string;
  website: string;
  location: string;
  country?: string;
  city?: string;
  last_active: string;
  is_cod: number;
  payment_methods: string; // JSON array
  other_profiles: string; // JSON array
  registration_info?: string;
  trade_license?: string;

  // Scoring
  risk_score: number;
  risk_category: string;
  risk_factors: string; // JSON array
  contact_score: number;
  contact_best_route: string;
  phone_confidence: string;
  whatsapp_confidence: string;
  email_confidence: string;
  website_confidence: string;
  social_confidence: string;
  fit_score: number;
  fit_reason: string;

  // Financial
  revenue_monthly: number;
  revenue_annual: number;
  setup_fee: number;
  transaction_rate: string;
  settlement_cycle: string;
  leakage_monthly_loss: number;
  leakage_missing_methods: string; // JSON array

  // Lifecycle
  status: LeadStatus;
  notes?: string;
  follow_up_date?: string;
  first_contact_date?: string;
  last_contact_date?: string;
  contact_outcome?: string;

  // Metadata
  discovery_run_id?: string;
  search_session_id?: string;
  first_found_date: string;
  last_validated_date?: string;
  scripts_arabic?: string;
  scripts_english?: string;
  scripts_whatsapp?: string;
  scripts_instagram?: string;
  created_at?: string;
  updated_at?: string;

  // Evidence (joined from API)
  evidence?: EvidenceSource[];
}

export interface SearchParams {
  keywords: string;
  location: string;
  categories: string[];
  subCategories: string[];
  businessAge?: '<1y' | '1-3y' | '>3y' | 'unknown';
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH' | 'ALL';
  minFollowers?: number;
  platforms: {
    instagram: boolean;
    facebook: boolean;
    telegram: boolean;
    tiktok: boolean;
    website: boolean;
  };
  maxResults: number;
}

export interface SearchResult {
  searchRunId: string;
  merchants: Merchant[];
  totalCandidates: number;
  duplicatesRemoved: number;
  dedupReasons: Record<string, number>;
  errors: string[];
}

export interface SearchHistory {
  id: string;
  sessionId: string;
  query: string;
  location: string;
  category: string;
  resultsCount: number;
  date: string;
}

export interface DashboardStats {
  total: number;
  byStatus: Record<string, number>;
  avgFitScore: number;
  avgContactScore: number;
  newThisWeek: number;
}
