export type RiskCategory = 'LOW' | 'MEDIUM' | 'HIGH';
export type ValidationStatus = 'VERIFIED' | 'PARTIALLY_VERIFIED' | 'UNVERIFIED' | 'DISCREPANCY';
export type ExclusionStatus = 'ACTIVE' | 'EXCLUDED' | 'BLACKLISTED';

export interface ContactValidation {
  status: ValidationStatus;
  sources: string[];
  notes?: string;
}

export interface RiskAssessment {
  score: number;
  category: RiskCategory;
  emoji: string;
  color: string;
  factors: string[];
}

export interface EvidenceSource {
  type: 'google_maps' | 'google_search' | 'official_registry' | 'other';
  title: string;
  uri: string;
}

export type LeadStatus = 
  | 'NEW' 
  | 'SEEN_BEFORE' 
  | 'CONTACTED' 
  | 'FOLLOW_UP' 
  | 'QUALIFIED' 
  | 'NOT_QUALIFIED' 
  | 'DUPLICATE' 
  | 'REJECTED' 
  | 'ONBOARDED' 
  | 'ARCHIVED';

export interface Lead {
  id: string;
  merchantId: string;
  status: LeadStatus;
  runId?: string;
  notes?: string;
  nextAction?: string;
  followUpDate?: string;
  firstContactAt?: string;
  lastContactAt?: string;
  outcome?: string;
  createdAt: string;
  updatedAt: string;
  merchant?: Merchant; // Joined data
}

export interface SearchRun {
  id: string;
  query: string;
  source?: string;
  resultsCount: number;
  newLeadsCount: number;
  status: 'pending' | 'completed' | 'failed';
  errorMessage?: string;
  createdAt: string;
}

export interface Merchant {
  id: string;
  merchantHash: string;
  mapsPlaceId?: string;
  evidence: EvidenceSource[];
  businessName: string;
  platform: string;
  url: string;
  instagramHandle?: string;
  facebookUrl?: string;
  twitterHandle?: string;
  linkedinUrl?: string;
  tiktokHandle?: string;
  telegramHandle?: string;
  githubUrl?: string;
  physicalAddress?: string;
  category: string;
  subCategory?: string;
  followers: number;
  bio: string;
  email: string;
  phone: string;
  whatsapp: string;
  website: string;
  location: string;
  lastActive: string;
  isCOD: boolean;
  paymentMethods: string[];
  contactValidation: ContactValidation;
  risk: RiskAssessment;
  revenue: {
    monthly: number;
    annual: number;
  };
  pricing: {
    setupFee: number;
    transactionRate: string;
    settlementCycle: string;
  };
  roi: {
    feeSavings: number;
    bnplUplift: number;
    cashFlowGain: number;
    totalMonthlyGain: number;
    annualImpact: number;
  };
  scripts: {
    arabic: string;
    english: string;
    whatsapp: string;
    instagram: string;
  };
  otherProfiles: { platform: string; url: string }[];
  registrationInfo?: string;
  tradeLicense?: string;
  foundDate: string;
  searchSessionId: string;
  analyzedAt: string;
  dulNumber?: string;
  contactScore?: number;
  fitScore?: number;
  confidenceScore?: number;
  qualityScore?: number;
  reliabilityScore?: number;
  complianceScore?: number;
  paymentGateway?: string;
  duplicateReason?: string;
  status?: string;
  evaluationGrade?: 'A' | 'B' | 'C' | 'D' | 'F';
  evaluationBreakdown?: {
    contactQuality: { score: number; weight: number; weighted: number };
    paymentReadiness: { score: number; weight: number; weighted: number };
    businessLegitimacy: { score: number; weight: number; weighted: number };
    socialPresence: { score: number; weight: number; weighted: number };
    revenuePotential: { score: number; weight: number; weighted: number };
    riskFactors: { score: number; weight: number; weighted: number };
  };
  evaluationRecommendation?: string;
  verification?: {
    status: string;
    sourcesConfirmed: number;
    totalSources: number;
    details: { field: string; sources: string[]; verified: boolean }[];
  };
}

export const UAE_EMIRATES = ['All', 'Dubai', 'Abu Dhabi', 'Sharjah', 'Ajman', 'Ras Al Khaimah', 'Fujairah', 'Umm Al Quwain', 'Al Ain'] as const;
export type Emirate = typeof UAE_EMIRATES[number];

export interface SearchParams {
  keywords: string;
  location: string;
  emirate: Emirate;
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

export interface SearchHistory {
  id: string;
  sessionId: string;
  query: string;
  location: string;
  category: string;
  resultsCount: number;
  date: string;
}
