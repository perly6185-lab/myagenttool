export type ArticleInspection = {
  canonicalUrl: string;
  provider: "wechat" | "xiaohongshu" | "zhihu" | "qichacha" | "juejin" | "jianshu" | "web";
  contentType: "article" | "note" | "company";
  title: string;
  author: string | null;
  publishedAt: string | null;
  publishedAtSource: "source" | "imported";
  textLength: number;
  mediaCounts: { images: number; audio: number; video: number };
};

export type ArticleImportJob = {
  id: string;
  worktreeId?: string;
  canonicalUrl?: string;
  state: "queued" | "running" | "completed" | "failed" | "canceled";
  progress: { stage: string; completed: number; total: number };
  error: string | null;
  result?: { markdownPath?: string; htmlPath?: string; analysisPath?: string; analysisWorkItemId?: string; warnings?: { code: string }[] } | null;
};

export type ArticleAnalysis = {
  schemaVersion: 1;
  title: string;
  generatedAt: string;
  method: "local-extractive-v1";
  coreIdeas: string[];
  framework: {
    order: number;
    heading: string;
    role: "introduction" | "development" | "evidence" | "boundary" | "conclusion";
    summary: string;
  }[];
  argumentPath: {
    role: "introduction" | "development" | "evidence" | "boundary" | "conclusion";
    statement: string;
  }[];
  keyConcepts: string[];
};

export type ArticleSimilarityMatch = {
  articleId: string;
  workItemId: string;
  localRef: string;
  worktreeId: string;
  markdownPath: string;
  canonicalUrl: string | null;
  title: string;
  author: string | null;
  provider: ArticleInspection["provider"] | null;
  publishedAt: string | null;
  score: number;
  reasons: ("core_ideas" | "structure" | "body" | "same_author" | "same_provider")[];
  sharedConcepts: string[];
  signals: {
    coreIdeas: number;
    titleStructure: number;
    body: number;
    metadata: number;
  };
};

export type ArticleSimilaritySearch = {
  method: "local-lexical-v1";
  matches: ArticleSimilarityMatch[];
  indexedCount: number;
  skippedCount: number;
  duplicateCount: number;
};

export type ArticleDerivative = {
  id: string;
  invocationId: string;
  sourceJobId: string;
  workItemId: string;
  sourceWorkItemId?: string;
  worktreeId: string;
  kind: "article_rewrite" | "video_script";
  tone: "insightful" | "practical" | "conversational";
  length: "short" | "medium" | "long";
  audiencePreset: "general" | "creator" | "product_manager" | "entrepreneur_investor" | "technical" | "custom";
  agePreset: "all" | "teen" | "18_24" | "25_34" | "35_49" | "50_plus" | "custom";
  ageDetails: string;
  targetAge: string;
  angle: string;
  audience: string;
  outputPath: string;
  state: "awaiting_approval" | "queued" | "running" | "completed" | "failed" | "canceled";
  error: string | null;
  agentId: string;
  createdAt: string;
  completedAt: string | null;
};

export type ArticleDerivativeRequest = Pick<
  ArticleDerivative,
  "kind" | "tone" | "length" | "audiencePreset" | "agePreset"
> & {
  audience: string;
  ageDetails: string;
  angle: string;
  idempotencyKey: string;
};
