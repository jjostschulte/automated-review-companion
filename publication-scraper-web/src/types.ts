
export type SearchResult = {
  matches: SearchMatch,
  results: Publication[],
  variations: KeywordVariation[],
}

export type KeywordVariation = {
  word: string,
  variants: string[]
  synonyms: Array<KeywordSynonym | string>
}

export type KeywordSynonym = {
  meaning: string,
  words: string[]
}

export type SearchMatch = {
  num_matches: number,
  papers: SearchMatchPaper[],
  percentage_match: number
}

export type SearchMatchPaper = {
  doi: string,
  title: string
}

export type Publication = {
  paper_id: string,
  paper_title: string,
  searched_from: string,
  search_string: string[] | string,
  formatted_search_string: string,
  status: string

  // Metadata fields
  abstract?: string,
  authors?: Author[],
  citation_count?: number,
  conference_journal?: string,
  doi?: string,
  publication_date?: string,
  publication_type?: string[],
  publisher?: string,
  semantic_scholar_url?: string,

  // LLM Questions
  llm_responses?: LLMUserAnswerResponse[]

  // Snowballing fields
  references?: Publication[],
  citations?: Publication[],
  showReferences?: boolean,
  showCitations?: boolean
  show?: boolean

  // View fields
  diffType?: DiffType
} 

export type DiffType = "add" | "remove" | "common" | "none"

export type SnowballingSearch = Publication & {
  references?: Publication[]
  citations?: Publication[]
}

export type Author = {
  name: string,
  affiliation: string[],
}

export type SearchForm = {
  id?: string,
  validation_papers: string[],
  search_terms: {
    advanced: string,
    primary: string[],
    secondary: string[],
    tertiary: string[]
  },
  start_date: Date,
  end_date: Date,
  sources: SearchEngineType[],
  llm_questions?: LLMQuestion[],
  llm_answers?: LLMUserAnswer[],
}

export enum SearchEngineType {
  DBLP = "DBLP",
  SEMANTIC_SCHOLAR = "SEMANTIC_SCHOLAR",
  WEB_OF_SCIENCE = "WEB_OF_SCIENCE",
  IEEE_XPLORE = "IEEE_XPLORE",
  SCOPUS = "SCOPUS"
}

export type LLMQuestion = {
  id: number,
  question: string,
  answer: string,
  rationale: string
}

export type LLMUserAnswer = {
  paper_id: string,
  responses: LLMUserAnswerResponse[]
}

export type LLMUserAnswerResponse = {
  id: number,
  answer: string
  rationale: string
}

export type LLMOptions = {
  includeExamples: boolean,
  includeRationale: boolean,
}

export type LLMPaperFilterResponse = {
  paper_id: string,
  response: LLMQuestion[]
}

export enum SearchMode {
  SIMPLE = "simple",
  ADVANCED = "advanced"
}

export enum PublicationOperation {
  POPULATE_METADATA = "populate_metadata",
  FORWARD_SEARCH = "forward_search",
  BACKWARD_SEARCH = "backward_search",
  LLM_FILTER = "llm_filter",
  DELETE = "delete"
}

export type ButtonState = {
  showSelectAll: boolean,
  showDeselectAll: boolean,
  showHideMetadata: boolean,
  showEnableFilters: boolean,
  showPopulateMetadata: boolean,
  showForwardSearch: boolean,
  showBackwardSearch: boolean,
  showExport: boolean,
  showLLMQuestions: boolean,
}
