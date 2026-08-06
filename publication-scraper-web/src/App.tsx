import '@/main.css';
import FullscreenIcon from '@mui/icons-material/Fullscreen';
import FullscreenExitIcon from '@mui/icons-material/FullscreenExit';
import { Box, Chip, CircularProgress, IconButton, Tooltip } from '@mui/material';
import axios from 'axios';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'react-toastify';
import { handleError } from './common/handler';
import CsvImportField from './components/CsvImportField';
import DatabaseSelector from './components/DatabaseSelector';
import ExportDropdown from './components/ExportDropdown';
import InputLabel from './components/InputLabel';
import PaperOperations from './components/PaperOperations';
import PublicationTable from './components/PublicationTable';
import SearchAppBar from './components/SearchAppBar';
import SearchHistoryHeaderCard from './components/SearchHistoryHeaderCard';
import SearchTermAutocomplete, { MultiLayerSearch } from './components/SearchTermAutocomplete';
import Spinner from './components/Spinner';
import UsabilityGuide from './components/UsabilityGuide';
import { Button } from './components/ui/button';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, CarouselApi } from './components/ui/carousel';
import { DatePicker } from './components/ui/date-picker';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from './components/ui/dropdown-menu';
import { MultiSelect } from './components/ui/multi-select';
import { tooltipText } from './data/tooltip';
import { cn } from './lib/utils';
import {
  ButtonState,
  DiffType,
  LLMOptions,
  LLMQuestion,
  LLMUserAnswer,
  Publication,
  SearchForm,
  SearchMode,
  SearchEngineType,
  SearchResult
} from './types';
import { BASE_URL } from './utils/common';
import { defaultButtonState, defaultDiffSearchResults, defaultLLMOptions, defaultLLMQuestions, defaultSearchForm, defaultSearchResult } from './utils/templates';
import { validateSearchForm } from './utils/validators';

export type FilterForm = {
  searchEngines: string[],
  conference: string[],
  llmQuestions: string[]
  llmAnswers: string[][]
  dateRange: {
    start: Date | undefined,
    end: Date | undefined
  }
}

type SearchHistorySummary = {
  id: string;
  query: Record<string, unknown>;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
};

const toStringArray = (value: unknown): string[] => {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
};

const toValidationPapers = (value: unknown): string[] => {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((paper) => {
      if (typeof paper === 'string') {
        return paper;
      }
      if (isRecord(paper)) {
        return typeof paper.doi === 'string' && paper.doi
          ? paper.doi
          : typeof paper.title === 'string'
            ? paper.title
            : '';
      }
      return '';
    })
    .filter((paper): paper is string => paper.length > 0);
};

const toSearchEngineSources = (value: unknown): SearchEngineType[] => {
  return toStringArray(value).filter((source): source is SearchEngineType => Object.values(SearchEngineType).includes(source as SearchEngineType));
};

const toDate = (value: unknown, fallback: Date): Date => {
  if (value instanceof Date) {
    return value;
  }
  if (typeof value === 'string' || typeof value === 'number') {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }
  return fallback;
};

const normalizeSearchHistoryEntry = (entry: SearchHistorySummary): SearchForm => {
  const query = isRecord(entry.query) ? entry.query : {};
  const searchTerms = isRecord(query.search_terms) ? query.search_terms : {};
  const sources = toSearchEngineSources(query.sources);

  return {
    id: entry.id,
    validation_papers: toValidationPapers(query.validation_papers),
    search_terms: {
      advanced: typeof searchTerms.advanced === 'string' ? searchTerms.advanced : '',
      primary: toStringArray(searchTerms.primary),
      secondary: toStringArray(searchTerms.secondary),
      tertiary: toStringArray(searchTerms.tertiary),
    },
    start_date: toDate(query.start_date, defaultSearchForm.start_date),
    end_date: toDate(query.end_date, defaultSearchForm.end_date),
    sources: sources.length > 0 ? sources : defaultSearchForm.sources,
  };
};

const getLLMExamplePaperIds = (llmAnswers: LLMUserAnswer[]) => llmAnswers.map((answer) => answer.paper_id);

function App() {
  const [searchForm, setSearchForm] = useState<SearchForm>(defaultSearchForm);
  const [searchResults, setSearchResults] = useState<SearchResult>(defaultSearchResult);
  const [selectedPapers, setSelectedPapers] = useState<string[]>([]);
  const [showClearDialog, setShowClearDialog] = useState(false);
  
  const [llmQuestions, setLLMQuestions] = useState<LLMQuestion[]>(defaultLLMQuestions);
  const [llmAnswers, setLLMAnswers] = useState<LLMUserAnswer[]>([]);
  const [llmOptions, setLLMOptions] = useState<LLMOptions>(defaultLLMOptions);
  const [searchMode, setSearchMode] = useState<SearchMode>(SearchMode.ADVANCED);
  const [showMetadata, setShowMetadata] = useState(true);
  const [showFilters, setShowFilters] = useState(false);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [showUsabilityGuide, setShowUsabilityGuide] = useState(false);

  const [manualAddPapers, setManualAddPapers] = useState<string[]>([]);
  const [isManuallyAddingPaper, setIsManuallyAddingPaper] = useState(false);

  const [buttonState, setButtonState] = useState<ButtonState>(defaultButtonState);
  const [fullscreenState, setFullscreenState] = useState(false);

  const [searchHistory, setSearchHistory] = useState<SearchForm[]>([]);
  const [currentSearchHistoryIndex, setCurrentSearchHistoryIndex] = useState(0);
  const [diffMode, setDiffMode] = useState(false);
  const [diffSearchHistoryIndex, setDiffSearchHistoryIndex] = useState<null | number>(null);
  const [diffSearchResults, setDiffSearchResults] = useState<SearchResult>(defaultDiffSearchResults);
  const [showDiffOnly, setShowDiffOnly] = useState(false);

  const mainDataTableRef = useRef<HTMLDivElement>(null);
  const diffDataTableRef = useRef<HTMLDivElement>(null);

  const handleScroll = (
    sourceTable: HTMLDivElement | null,
    targetTable: HTMLDivElement | null
  ) => {
    if (sourceTable && targetTable) {
      targetTable.scrollLeft = sourceTable.scrollLeft; // Horizontal scroll
      targetTable.scrollTop = sourceTable.scrollTop;   // Vertical scroll
    }
  }
  
  // TODO: store a search reference id of the results it provides;
  // query endpoint when triggered to get the results of the search
    
  const numMatched = searchResults?.matches?.num_matches;
  const percentageMatched = searchResults?.matches?.percentage_match;
  
  const multiLayerSearchFields: MultiLayerSearch[] = ['primary', 'secondary', 'tertiary']; 

  const [filterForm, setFilterForm] = useState<FilterForm>({
    searchEngines: [],
    conference: [],
    llmQuestions: [],
    llmAnswers: [],
    dateRange: {
      start: undefined,
      end: undefined
    }
  })


  /**
   * Parses the root papers from the search form, and returns an array of objects with doi and title fields 
   * @param papers DOIs or paper titles 
   * @returns Array of objects with doi and title fields
   */
  const parseRootPapers = (papers: string[]) => {
    if (!papers || papers.length === 1 && !papers[0]) return [];
    return papers.map((paper) => {
      const doi = paper.match(/10\.\d{4,9}\/[-._;()/:A-Z0-9]+/ig)?.[0];
      return {
        doi: doi ?? '',
        title: doi ? '' : paper
      }
    })
  }

  const handleSearchFormChange = (value: string[], field: MultiLayerSearch) => {
    setSearchForm({
      ...searchForm,
      search_terms: { ...searchForm.search_terms, [field]: value }
    })
  }

  const cleanAdvancedSearch = (searchPhrase: string) => {
    return searchPhrase.replace(/ AND /ig, ' and ')
      .replace(/ OR /ig, ' or ')
      .replace(/ NOT /ig, ' not ')
      .replace(/"/g, "'");
  }

  const handleSearch = async () => {
    if (!validateSearchForm(searchForm, searchMode) || isSearching) return;
    setIsSearching(true);
    toast.info('Searching...');
    const cleanedAdvancedSearch = cleanAdvancedSearch(searchForm.search_terms.advanced);
    
    // Remove existing id to ensure a new unique id is generated
    const searchFormWithoutId = { ...searchForm };
    delete searchFormWithoutId.id;
    
    const payload = {
      ...searchFormWithoutId,
      search_terms: {
        advanced: searchMode === SearchMode.ADVANCED ? cleanedAdvancedSearch : "",
        primary: searchMode === SearchMode.SIMPLE ? searchFormWithoutId.search_terms.primary : [],
        secondary: searchMode === SearchMode.SIMPLE ? searchFormWithoutId.search_terms.secondary : [],
        tertiary: searchMode === SearchMode.SIMPLE ? searchFormWithoutId.search_terms.tertiary : []
      },
      validation_papers: parseRootPapers(searchFormWithoutId.validation_papers)
    }
    
    await axios.post(`${BASE_URL}/scraper/search-and-clean`, payload)
      .then((res) => {
        const data = res.data;
        const newSearchResults = {
          ...data,
          results: data.results.map((paper: Publication) => ({...paper, show: true}))
        }
        setSearchResults(newSearchResults);

        const failedEngines = Object.entries(data.engine_errors ?? {});
        if (failedEngines.length > 0) {
          failedEngines.forEach(([engine, message]) => {
            toast.warn(`${engine} was skipped: ${message}`);
          });
        }
        toast.success(`Search complete: ${data.results.length} publication(s) found`);
        setButtonState((prevState) => ({
          ...prevState,
          showSelectAll: true,
          showDeselectAll: true,
          showForwardSearch: true,
          showBackwardSearch: true,
          showPopulateMetadata: true,
          showHideMetadata: true,
        }))
        setSearchHistory([...searchHistory, { id: res.data.id, ...payload, validation_papers: searchFormWithoutId.validation_papers }]);
        setCurrentSearchHistoryIndex(searchHistory.length);
      })
      .catch(handleError)
      .finally(() => setIsSearching(false));
  }

  const updateSearchResults = async (papers: Publication[]) => {
    const searchReferenceId = searchHistory[currentSearchHistoryIndex]?.id;
    if (!searchReferenceId) {
      createSearchResult(papers);
    } else {
      await axios.put(
        `${BASE_URL}/scraper/history/publications?search_reference_id=${searchReferenceId}`, 
        { papers }
      )
        .then((res) => console.log(`Persisted search results with: ${res.data.length} new papers`))
        .catch(handleError);
    }
  }

  const createSearchResult = async (papers: Publication[]) => {
    await axios.post(`${BASE_URL}/scraper/history/publications`, { papers })
      .then((res) => {
        console.log(`Created search results with: ${res.data.length} papers`)
        // Push to the search history
        setSearchHistory((prevState) => [
          ...prevState, {
            id: res.data.id,
            validation_papers: searchForm.validation_papers,
            search_terms: {
              advanced: "",
              primary: [],
              secondary: [],
              tertiary: [],
            },
            start_date: new Date(res.data.query.start_date),
            end_date: new Date(res.data.query.end_date),
            sources: res.data.query.sources,
          }
        ]);
        setButtonState((prevState) => ({
          ...prevState,
          showSelectAll: true,
          showDeselectAll: true,
          showForwardSearch: true,
          showBackwardSearch: true,
          showPopulateMetadata: true,
          showHideMetadata: true,
          showExport: true,
        }))
      })
      .catch(handleError);
  }

  const handleAddPaper = async () => {
    if (!manualAddPapers || manualAddPapers.length === 0 || (manualAddPapers.length === 1 && !manualAddPapers[0])) {
      toast.error('No papers to add');
      return;
    }
    setIsManuallyAddingPaper(true);
    toast.info('Adding papers...');
    await addManualPapers(manualAddPapers);
  }

  const addManualPapers = async (paperDOIs: string[]) => {
    await axios.post(`${BASE_URL}/scraper/manual-add-publication`, {
      dois: paperDOIs
    })
    .then(async (res) => {
      const modifiedResults = res.data.publications.map((paper: Publication) => ({...paper, searched_from: "MANUAL", search_string: 'MANUAL', formatted_search_string: 'Not Applicable'}));
      const newResults = modifiedResults.filter((paper: Publication) => !searchResults.results.find((result: Publication) => result.paper_id === paper.paper_id));
      setSearchResults({...searchResults, results: [...searchResults.results, ...newResults]});
      toast.success('Papers added successfully');
      await updateSearchResults(newResults);
      setButtonState((prevState) => ({
        ...prevState,
        showPopulateMetadata: true,
        showForwardSearch: true,
        showBackwardSearch: true
      }))
    })
    .catch(handleError)
    .finally(() => setIsManuallyAddingPaper(false));
  }

  const handleSelectAll = () => {
    setSelectedPapers(searchResults.results.map((result: Publication) => result.paper_id))
  }

  const handleDeselectAll = () => {
    setSelectedPapers([])
  }

  const handlePaperSelect = (paper_id: string) => {
    if (selectedPapers.includes(paper_id)) {
      setSelectedPapers(selectedPapers.filter((id) => id !== paper_id))
    } else {
      setSelectedPapers([...selectedPapers, paper_id])
    }
  }

  const handleShowMetadata = () => {
    setShowMetadata(!showMetadata)
  }

  const handleShowFilters = () => {
    setShowFilters(!showFilters)
  }

  const handleSelectSearchMode = (mode: SearchMode) => {
    setSearchMode(mode);
  }

  const resetSearchParameters = () => {
    setSearchForm(defaultSearchForm);
    setSearchResults(defaultSearchResult);
    setSelectedPapers([]);
    setLLMQuestions(defaultLLMQuestions);
    setLLMAnswers([]);
    setButtonState(defaultButtonState);
    setShowClearDialog(false);
}

  const handleChipClick = (keyword: string, field: MultiLayerSearch) => {
    setSearchForm({
      ...searchForm,
      search_terms: {
        ...searchForm.search_terms,
        [field]: [
          ...searchForm.search_terms[field],
          keyword
        ]
      }
    })
  }

  const handleFullScreen = () => {
    setFullscreenState(!fullscreenState);
    // get id = publication-data, add container class to it
    const publicationData = document.getElementById('publication-data');
    const publicationDataInner = document.getElementById('publication-data-inner');
    if (publicationData) {
      publicationData.classList.toggle('container');
      publicationDataInner?.classList.toggle('container');
    }
  }
  
  const handleDiffMode = () => {
    
    if (diffMode) {
      setShowDiffOnly(false); // Reset showDiffOnly when disabling diff mode
      setDiffSearchHistoryIndex(null);
      const prevSearchResults = [...searchResults.results];
      const newPrevSearchResults = prevSearchResults.map((result: Publication) => {
        return { ...result, diffType: undefined }
      });
      setSearchResults({...searchResults, results: newPrevSearchResults});
    }
    
    const publicationData = document.getElementsByClassName('main-data-table')[0];
      if (publicationData) {
        publicationData.classList.toggle('col-6');
      }
    setDiffMode(!diffMode);
  }

  const handleChooseSearchHistory = async (index: number) => {
    if (!diffMode) {
      setCurrentSearchHistoryIndex(index);
      await axios.get(`${BASE_URL}/scraper/historical-search`, {
        params: { id: searchHistory[index].id }
      })
      .then((res) => {
        setSearchForm(searchHistory[index]);
        setSearchResults(res.data);
        const restoredLLMAnswers = res.data.llm_answers ?? [];
        setLLMQuestions(res.data.llm_questions ?? []);
        setLLMAnswers(restoredLLMAnswers);
        setSelectedPapers(getLLMExamplePaperIds(restoredLLMAnswers));
        setLLMOptions({
          includeExamples: restoredLLMAnswers.length > 0,
          includeRationale: restoredLLMAnswers.length > 0,
        });
        setButtonState((prevState) => ({
          ...prevState,
          showSelectAll: true,
          showDeselectAll: true,
          showForwardSearch: true,
          showBackwardSearch: true,
          showPopulateMetadata: true,
          showHideMetadata: true,
          showExport: true,
        }))
      })
      .catch(handleError)

    } else {
      if (currentSearchHistoryIndex === index) {
        toast.info('Cannot choose the same search history to compare');
        return;
      }
      await axios.get(`${BASE_URL}/scraper/historical-search`, {
        params: { id: searchHistory[index].id }
      })
      .then((res) => handleDiffModeClassification(res.data))
      .catch(handleError)
      .finally(() => setDiffSearchHistoryIndex(index));
    }
  }

  const handleDiffModeClassification = (newSearchResults: SearchResult) => {
    // setDiffSearchResults(newSearchResults); 

    // Handle the diff mode classification here
    // new search result = searchResults
    // old search result = diffSearchResults
    // 1. if paper is only in the new search results, set diffType to 'add'
    //    ALSO, add a dummy paper for the old search results with empty fields

    // 2. if paper is only in the old search results, set diffType to 'remove'
    //    ALSO, add a dummy paper for the new search results with empty fields
    const dummyPaper = (diffType: DiffType): Publication => ({
      paper_id: 'n/a',
      paper_title: '',
      authors: [],
      abstract: '',
      publication_date: '',
      conference_journal: '',
      doi: '',
      searched_from: '',
      search_string: '',
      formatted_search_string: '',
      status: '',
      diffType: diffType,
      show: true,
    });

    const updatedResults = [...searchResults.results];
    const newUpdatedResults = updatedResults.map((result: Publication) => {
      if (!newSearchResults.results.find((r) => r.paper_id === result.paper_id)) {
        return { ...result, diffType: ('add' as DiffType) }
      }
      return { ...result, diffType: ('common' as DiffType) }
    });

    const newDiffSearchResults = newSearchResults.results.map((result: Publication) => {
      const index = searchResults.results.findIndex((r) => r.paper_id === result.paper_id);
      if (index === -1) {
        return { ...result, diffType: ('remove' as DiffType)  }
      }
      return { ...result, diffType: ('common' as DiffType) }
    });

    // Get total number of papers
    const commonPapers = newUpdatedResults.filter((result: Publication) => result.diffType === 'common').length;
    const addedPapers = newUpdatedResults.filter((result: Publication) => result.diffType === 'add').length;
    const removedPapers = newDiffSearchResults.filter((result: Publication) => result.diffType === 'remove').length;
    const totalPapers = commonPapers + addedPapers + removedPapers;

    const newUpdatedResultsWithDummy = [];
    const newDiffSearchResultsWithDummy = [];

    // Iterate through the new search results and add dummy papers for the old search results
    let updatedResultsIdx = 0;
    let diffResultsIdx = 0;
    for (let i = 0; i < totalPapers; i++) {
      if (
        newUpdatedResults[updatedResultsIdx]?.diffType === 'common' &&
        newDiffSearchResults[diffResultsIdx]?.diffType === 'common'
      ) {
        newUpdatedResultsWithDummy.push(newUpdatedResults[updatedResultsIdx]);
        newDiffSearchResultsWithDummy.push(newDiffSearchResults[diffResultsIdx]);
        updatedResultsIdx++;
        diffResultsIdx++;
        continue;
      }
      
      if (
        i < newUpdatedResults.length &&
        newUpdatedResults[updatedResultsIdx].diffType === 'add'
      ) {
        newUpdatedResultsWithDummy.push(newUpdatedResults[updatedResultsIdx]);
        newDiffSearchResultsWithDummy.push(dummyPaper('none'));
        updatedResultsIdx++;
        continue;
      }

      if (
        i < newDiffSearchResults.length &&
        newDiffSearchResults[diffResultsIdx].diffType === 'remove'
      ) {
        newUpdatedResultsWithDummy.push(dummyPaper('none'));
        newDiffSearchResultsWithDummy.push(newDiffSearchResults[diffResultsIdx]);
        diffResultsIdx++;
        continue;
      }
    }

    setSearchResults({...searchResults, results: newUpdatedResultsWithDummy});
    setDiffSearchResults({ ...newSearchResults, results: newDiffSearchResultsWithDummy });
  }

  const handleAdvancedChipClick = (keyword: string, synonym: string) => {
    
    // Surround keyword/synonym phrases with quotes if they contain spaces
    if (keyword.split(' ').length > 1) {
      keyword = `"${keyword}"`;
    }
    if (synonym.split(' ').length > 1) {
      synonym = `"${synonym}"`;
    }

    const replacement = `(${keyword} or ${synonym})`;
    setSearchForm({
      ...searchForm,
      search_terms: {
        ...searchForm.search_terms,
        advanced: searchForm.search_terms.advanced.replace(keyword, replacement),
      }
    })
  }

  const handleShowDiffOnly = () => {
    // Toggle the showDiffOnly state
    setShowDiffOnly(!showDiffOnly);
    
    // Handle Original Search Results
    const updatedResults = [...searchResults.results];
    const newUpdatedResults = updatedResults.map((result: Publication) => {
      if (result.diffType === 'common') {
        return { ...result, show: showDiffOnly } // If currently showing diff only, show all; otherwise hide common
      }
      return { ...result, show: true }
    });
    setSearchResults({...searchResults, results: newUpdatedResults});

    // Handle diff search results
    const updatedDiffResults = [...diffSearchResults.results];
    const newUpdatedDiffResults = updatedDiffResults.map((result: Publication) => {
      if (result.diffType === 'common') {
        return { ...result, show: showDiffOnly } // If currently showing diff only, show all; otherwise hide common
      }
      return { ...result, show: true }
    });
    setDiffSearchResults({...diffSearchResults, results: newUpdatedDiffResults});
  }

  const parseSearchId = (id: string | undefined) => {
    if (!id) return null;
    return id.split('-')[0];
  }

  const applyFilters = () => {

    const newSearchResults = { ...searchResults };
    for (let i = 0; i < newSearchResults.results.length; i++) {
      newSearchResults.results[i].show = true;

      // 1. Check if the search engine is in the filter form
      if (
        filterForm.searchEngines.length > 0 &&
        !filterForm.searchEngines.some(engine => searchResults.results[i].searched_from?.includes(engine))
      ) {
        newSearchResults.results[i].show = false;
        continue;
      }

      // 2. Check if the conference is in the filter form
      if (
        filterForm.conference.length > 0 &&
        !filterForm.conference.some(conference => searchResults.results[i].conference_journal?.includes(conference))
      ) {
        newSearchResults.results[i].show = false;
        continue;
      }

      // 3. Check if publication date is within the date range
      if (
        filterForm.dateRange.start && filterForm.dateRange.end &&
        filterForm.dateRange.start <= filterForm.dateRange.end
      ) {
        if (
          searchResults.results[i].publication_date === undefined ||
          new Date(searchResults.results[i].publication_date!) < filterForm.dateRange.start ||
          new Date(searchResults.results[i].publication_date!) > filterForm.dateRange.end
        ) {
          newSearchResults.results[i].show = false;
          continue;
        }
      }

      // 3. Check if the LLM question & corresponding answer is in the filter form
      if (filterForm.llmQuestions.length > 0) {
        const questionIdsWithFilterEnabled = filterForm.llmQuestions.map((questionId) => Number(questionId));
        const responses = searchResults.results[i].llm_responses;
        for (const questionId of questionIdsWithFilterEnabled) {
          const filteredAnswers = filterForm.llmAnswers[questionId] ?? [];
          if (filteredAnswers.length === 0) continue;

          const response = responses?.find((response) => Number(response.id) === questionId);
          if (!response || !filteredAnswers.includes(response.answer)) {
            newSearchResults.results[i].show = false;
            break;
          }
        }
      }
    }
    const numberOfShownRecords = newSearchResults.results.filter((result) => result.show).length;
    toast.info(`Showing ${numberOfShownRecords} records`);
    setSearchResults(newSearchResults);
  }
  // State to store the Embla Carousel API instance.
  const [carouselApi, setCarouselApi] = useState<CarouselApi | null>(null);

  useEffect(() => {
    let isMounted = true;

    const loadSearchHistory = async () => {
      try {
        const res = await axios.get<{ history: SearchHistorySummary[] }>(`${BASE_URL}/scraper/history/list`);
        if (!isMounted) {
          return;
        }

        const normalizedHistory = res.data.history.map(normalizeSearchHistoryEntry).reverse();
        setSearchHistory(normalizedHistory);
        if (normalizedHistory.length > 0) {
          const latestIndex = normalizedHistory.length - 1;
          setCurrentSearchHistoryIndex(latestIndex);

          const latestHistory = res.data.history[0];
          const latestResponse = await axios.get(`${BASE_URL}/scraper/historical-search`, {
            params: { id: latestHistory.id }
          });
          if (!isMounted) {
            return;
          }

          setSearchForm(normalizeSearchHistoryEntry(latestHistory));
          setSearchResults(latestResponse.data);
          const restoredLLMAnswers = latestResponse.data.llm_answers ?? [];
          setLLMQuestions(latestResponse.data.llm_questions ?? []);
          setLLMAnswers(restoredLLMAnswers);
          setSelectedPapers(getLLMExamplePaperIds(restoredLLMAnswers));
          setLLMOptions({
            includeExamples: restoredLLMAnswers.length > 0,
            includeRationale: restoredLLMAnswers.length > 0,
          });
          setButtonState((prevState) => ({
            ...prevState,
            showSelectAll: true,
            showDeselectAll: true,
            showForwardSearch: true,
            showBackwardSearch: true,
            showPopulateMetadata: true,
            showHideMetadata: true,
            showExport: true,
          }))
        }
      } catch (err) {
        console.error('Failed to load search history', err);
      }
    };

    loadSearchHistory();

    return () => {
      isMounted = false;
    };
  }, []);

  // Auto-focus on the latest carousel item when searchHistory updates
  useEffect(() => {
    if (searchHistory.length > 0 && carouselApi) {
      carouselApi.reInit();
  
      const latestIndex = searchHistory.length - 1;
      setCurrentSearchHistoryIndex(latestIndex);

      setTimeout(() => {
        carouselApi.scrollTo(latestIndex);
      }, 50); // Adjust delay if needed
    }
  }, [searchHistory, carouselApi]);

  return (
      <div className="mt-3">
        <div className="container">
          <h1 className="text-3xl md:text-4xl font-medium">ARC: Automated Review Companion</h1>
        
          {/* Search Bar */}
          <div className="p-3 mt-3 border rounded" id="search-bar">
            <div className="d-flex flex-row flex-wrap justify-content-between align-items-start gap-2">
              <h3 className="text-3xl font-medium">Search Bar</h3>
              <div className="d-flex gap-2">
                <UsabilityGuide
                  showUsabilityGuide={showUsabilityGuide}
                  setShowUsabilityGuide={setShowUsabilityGuide}
                  handleClose={() => setShowUsabilityGuide(false)}
                />
              </div>
            </div>

            <SearchAppBar searchMode={searchMode} handleSelectSearchMode={handleSelectSearchMode} />

            <div className="divider border-bottom"></div>
            {/* Multi-layer Keyword Search */}
            <div className="mt-3">
              {searchMode === SearchMode.SIMPLE && (
                  <div className="input-group mb-3 d-flex flex-column">
                    {multiLayerSearchFields.map((field) => (
                        <SearchTermAutocomplete
                            key={field}
                            field={field}
                            searchForm={searchForm}
                            searchResults={searchResults}
                            setSearchResults={setSearchResults}
                            handleSearchFormChange={handleSearchFormChange}
                            handleChipClick={handleChipClick}
                        />))}
                  </div>
              )}

              {searchMode === SearchMode.ADVANCED && (
                  <>
                    <div className="input-group mb-3">
                      <InputLabel tooltip={tooltipText.search.advanced} label="Advanced Search" required/>
                      <input
                          type="text"
                          className="form-control"
                          placeholder='AI AND ("Machine Learning" OR "Generative AI") AND NOT Education'
                          value={searchForm.search_terms.advanced}
                          onChange={(e) => setSearchForm({
                            ...searchForm,
                            search_terms: {...searchForm.search_terms, advanced: e.target.value}
                          })}
                      />
                    </div>
                    <div className="container">
                      {searchResults.variations.length > 0 && (
                          <div className="flex flex-row gap-2 flex-wrap my-3">
                            <span className="text-center">Variations:</span>
                            {searchResults.variations.map((variation) => (
                                <Tooltip
                                    key={variation.word}
                                    title={
                                      <div className="d-flex flex-column gap-2">
                                        <span>Synonyms (From <a className="text-blue-300"
                                                                href={`https://www.thesaurus.com/browse/${variation.word}`}
                                                                target="_blank"
                                                                rel="noreferrer">Thesaurus.com</a>:):</span>
                                        <Box className="word-variant-box mb-2">
                                          {variation.synonyms.map((rawSynonym) => {
                                            const synonym = typeof rawSynonym === "string"
                                              ? { meaning: rawSynonym, words: [rawSynonym] }
                                              : rawSynonym;
                                            return (
                                              <div key={variation.word + synonym.meaning}>
                                                <div>Meaning: {synonym.meaning}</div>
                                                <div className="word-variant-box">
                                                  {synonym.words.map((word: string) =>
                                                      <div
                                                          key={word}
                                                          onClick={() => handleAdvancedChipClick(variation.word, word)}
                                                          className='word-variant-chip'
                                                          style={{color: "black", cursor: "pointer"}}
                                                      >
                                                        {word}
                                                      </div>
                                                  )}
                                                </div>
                                              </div>
                                            );
                                          })}
                                          {variation.variants.length > 0 && <span>Variants:</span>}
                                          {variation.variants.map((variant) => (
                                              <div
                                                  key={variant}
                                                  onClick={() => handleAdvancedChipClick(variation.word, variant)}
                                                  className='word-variant-chip'
                                                  style={{color: "black", cursor: "pointer"}}
                                              >
                                                {variant}
                                              </div>
                                          ))}
                                        </Box>
                                      </div>
                                    }>
                                  <Chip
                                      key={variation.word}
                                      label={variation.word}
                                      className='p-0 m-0'
                                  />
                                </Tooltip>
                            ))}
                          </div>
                      )}
                    </div>
                  </>
              )}

              {/* Date Range */}
              <div className="input-group mb-3">
                <InputLabel tooltip={tooltipText.search.dateRange} label="Date Range" required/>

                <div className="flex items-center space-x-4">
                  <div className="flex items-center space-x-2 ml-4">
                    <label htmlFor="start-date" className="whitespace-nowrap">Start Date:</label>
                    <input
                        id="start-date"
                        type="date"
                        className="form-control"
                        max={searchForm.end_date.toISOString().slice(0, 10)}
                        value={searchForm.start_date.toISOString().slice(0, 10)}
                        onChange={(e) => {
                          const next = new Date(e.target.value);
                          if (!e.target.value || isNaN(next.getTime())) {
                            toast.error('Please enter a valid start date.');
                            return;
                          }
                          if (next > searchForm.end_date) {
                            toast.error('Start date must be on or before the end date.');
                            return;
                          }
                          setSearchForm({ ...searchForm, start_date: next });
                        }}
                    />
                  </div>

                  <div className="flex items-center space-x-2">
                    <label htmlFor="end-date" className="whitespace-nowrap">End Date:</label>
                    <input
                        id="end-date"
                        type="date"
                        className="form-control"
                        min={searchForm.start_date.toISOString().slice(0, 10)}
                        value={searchForm.end_date.toISOString().slice(0, 10)}
                        onChange={(e) => {
                          const next = new Date(e.target.value);
                          if (!e.target.value || isNaN(next.getTime())) {
                            toast.error('Please enter a valid end date.');
                            return;
                          }
                          if (next < searchForm.start_date) {
                            toast.error('End date must be on or after the start date.');
                            return;
                          }
                          setSearchForm({ ...searchForm, end_date: next });
                        }}
                    />
                  </div>
                </div>
              </div>


              {/*  Database Types */}
              <div className="d-flex flex-row w-100 mb-3">
                <InputLabel tooltip={tooltipText.search.database} label="Database Types" required/>
                <DatabaseSelector searchForm={searchForm} setSearchForm={setSearchForm}/>
              </div>

              {/* Validation Papers */}
              <div className="d-flex flex-row w-100">
                <Tooltip title={tooltipText.search.validationPapers.hint} placement='right'>
                  <div className="input-group-prepend">
                    <span className="input-group-text rounded-0" id="basic-addon1">Validation Papers</span>
                  </div>
                </Tooltip>
                <input
                    type="text"
                    className="form-control"
                    placeholder={tooltipText.search.validationPapers.example}
                    value={searchForm.validation_papers.join(',')}
                    onChange={(e) => setSearchForm({...searchForm, validation_papers: e.target.value.split(',')})}
                />
              </div>

              {/* Root Paper matches */}
              {
                  searchForm.validation_papers.length > 0 &&
                  <div className="d-flex flex-column w-100 mt-3">
                    <div className="d-flex flex-row align-items-center gap-2 w-100">
                      <span>Result:</span>
                      <progress className='w-75' value={percentageMatched} max="100"/>
                      <span> {numMatched}/{searchForm.validation_papers.length} ({percentageMatched}%) matches</span>
                    </div>
                    <div className="table-responsive mt-3">
                      <table className="table table-striped">
                        <thead className='bg-primary text-white'>
                        <tr>
                          <td>#</td>
                          <td>DOI/Paper Title</td>
                        </tr>
                        </thead>
                        <tbody>
                        {/* Show the percentage matched with a progress bar (bootstrap), the total number of matches, and all the matches in tiny rows */}
                        {
                            searchResults?.matches?.papers?.length > 0 &&
                            searchResults.matches.papers.map((match, index) => (
                                <tr key={`${match.doi || match.title}-${index}`}>
                                  <td>{index + 1}</td>
                                  <td>{match.doi || match.title}</td>
                                </tr>
                            ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
              }


              {/* Buttons */}
              <div className="d-flex flex-row justify-content-end mt-3 gap-2">
                <Button onClick={handleSearch}>
                  {
                    isSearching
                        ? <Spinner/>
                        : <span>Search</span>
                  }
                </Button>
                <Tooltip title={tooltipText.search.clearButton} placement="top">
                  <Button className="bg-red-600 hover:bg-red-700/80" onClick={() => setShowClearDialog(true)}>Clear</Button>
                </Tooltip>
                <Dialog open={showClearDialog}>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Clearing Search Parameters</DialogTitle>
                    </DialogHeader>
                    <DialogDescription>
                      <span>Are you sure about clearing all search parameters?</span>
                    </DialogDescription>
                    <DialogFooter>
                      <Button className="bg-red-600 hover:bg-red-800" onClick={resetSearchParameters}>Yes</Button>
                      <Button onClick={() => setShowClearDialog(false)}>Close</Button>
                    </DialogFooter>
                  </DialogContent>
                </Dialog>
                
              </div>
            </div>
          </div>
        </div>

        {/* Search History */}
      {searchHistory.length > 0 && (
        <div className="container mt-3">
          <div className="container rounded border p-3" id="search-history">
            <div className="d-flex justify-content-between mb-3">
              <h3 className="text-3xl font-medium">Search History</h3>
              <div className="flex gap-2">
                {diffMode && (
                  <Tooltip title={tooltipText.search.history} placement="top">
                    <Button className="bg-slate-400 hover:bg-slate-500/80" onClick={handleShowDiffOnly}>
                      {showDiffOnly ? "Hide Diff Only" : "Show Diff Only"}
                    </Button>
                  </Tooltip>
                )}

                <Tooltip title={tooltipText.search.history} placement="top">
                  <span>
                    <Button className="bg-blue-500/80" onClick={handleDiffMode} disabled={searchHistory.length < 2}>
                      {!diffMode ? "Enable Diff mode" : "Disable Diff mode"}
                    </Button>
                  </span>
                </Tooltip>
              </div>
            </div>

            <section className="w-100 px-12 py-3">
              {/* Pass setCarouselApi to the Carousel so it can send back the Embla API */}
              <Carousel opts={{ align: "start" }} className="w-full" setApi={setCarouselApi}>
                <CarouselContent>
                  {searchHistory.map((search, index) => (
                    <CarouselItem
                      id={`carousel-item-${index}`}
                      key={index}
                      className="md:basis-1/2 lg:basis-1/3"
                      onClick={() => handleChooseSearchHistory(index)}
                    >
                      <div className="p-1">
                        <Tooltip
                          title={
                            <Box>
                              <div>Search {index + 1}</div>
                              <div>Ref: {search.id ?? "-"}</div>
                              <div>
                                Year Range:{" "}
                                {search.start_date.toISOString().split("T")[0]} -{" "}
                                {search.end_date.toISOString().split("T")[0]}
                              </div>
                              {search.search_terms.advanced ? (
                                <div>Advanced Search: {search.search_terms.advanced}</div>
                              ) : (
                                <>
                                  <div>Primary Search: {search.search_terms.primary.join(", ")}</div>
                                  <div>Secondary Search: {search.search_terms.secondary.join(", ")}</div>
                                  <div>Tertiary Search: {search.search_terms.tertiary.join(", ")}</div>
                                </>
                              )}
                              <div>Sources: {search.sources.join(', ')}</div>
                            </Box>
                          }
                          placement="top"
                        >
                          <Button
                            className={cn(
                              "block w-full h-24 bg-slate-50 text-black hover:bg-blue-200/80 border-slate-400 border-1",
                              (index === currentSearchHistoryIndex && !diffMode ? "bg-blue-500/80 hover:bg-blue-600/80 text-white" : "") +
                                (index === currentSearchHistoryIndex && diffMode ? "diff-mode-red" : "") +
                                (diffMode && diffSearchHistoryIndex === index ? "diff-mode-green" : "")
                            )}
                          >
                            <div className="leading-[14px] whitespace-nowrap overflow-hidden text-ellipsis w-full">
                              Search {index + 1} : {search.start_date.toISOString().split("T")[0]} - {search.end_date.toISOString().split("T")[0]}
                            </div>
                            <div className="leading-[14px] text-muted whitespace-nowrap overflow-hidden text-ellipsis w-full">
                              Ref: {parseSearchId(search.id) ?? "-"}
                            </div>
                            {search.search_terms.advanced && (
                              <div className="leading-[14px] text-muted whitespace-nowrap overflow-hidden text-ellipsis w-full">
                                Advanced Search: {search.search_terms.advanced}
                              </div>
                            )}
                            {search.search_terms.primary.length > 0 && (
                              <div className="leading-[14px] text-muted whitespace-nowrap overflow-hidden text-ellipsis w-full">
                                Primary Search: {search.search_terms.primary.join(', ')}
                              </div>
                            )}
                            {search.search_terms.secondary.length > 0 && (
                              <div className="leading-[14px] text-muted whitespace-nowrap overflow-hidden text-ellipsis w-full">
                                Secondary Search: {search.search_terms.secondary.join(', ')}
                              </div>
                            )}
                            {search.search_terms.tertiary.length > 0 && (
                              <div className="leading-[14px] text-muted whitespace-nowrap overflow-hidden text-ellipsis w-full">
                                Tertiary Search: {search.search_terms.tertiary.join(', ')}
                              </div>
                            )}
                          </Button>
                        </Tooltip>
                      </div>
                    </CarouselItem>
                  ))}
                </CarouselContent>
                <CarouselPrevious />
                <CarouselNext />
              </Carousel>
            </section>
          </div>
        </div>
      )}
        
        {/* Publications Data */}
        <section className="container overflow-auto" id="publication-data">
          <div className="p-3 mt-3 border rounded container" id="publication-data-inner">
            <div className="d-flex align-items-end gap-2 justify-content-between">
              <h3 className="p-0 m-0 text-3xl font-medium">Search Results</h3>
              {/* Button to make fullscreen */}
              <Tooltip title={fullscreenState ? tooltipText.results.toggleFullScreen.exit : tooltipText.results.toggleFullScreen.enter} placement="top">
                <IconButton onClick={handleFullScreen}>
                  {fullscreenState ? <FullscreenExitIcon/> : <FullscreenIcon/>}
                </IconButton>
              </Tooltip>
            </div>
            <div>Total Publications: {searchResults.results.length}</div>
                
            <div className="d-flex flex-column justify-content-between items-align-end mb-3 gap-2">
              
              <div className="manual-add-row">
                  <InputLabel tooltip={tooltipText.results.manualAdd} label="Manual Add" className="manual-add-label"/>
                  <input
                      type="text"
                      disabled={diffMode}
                      className="form-control manual-add-input"
                      placeholder="10.18653/v1/N18-3011"
                      value={manualAddPapers.join(',')}
                      onChange={(e) => setManualAddPapers(e.target.value.split(','))}
                  />
                  <Button
                    className="manual-add-button bg-blue-500 shadow-none"
                    disabled={diffMode}
                    onClick={handleAddPaper}
                  >
                    { 
                      isManuallyAddingPaper ? 
                      <CircularProgress size={18} color="inherit" /> :
                      <span>Add</span>
                    } 
                  </Button>
                  <CsvImportField 
                    addManualPapers={addManualPapers}
                    disabled={diffMode ?? false}
                    tooltip={tooltipText.results.manualAddCsv} 
                  />
              </div>

              <div id="paper-operations" className='results-toolbar'>
                <div className="results-selection-summary">
                  {selectedPapers.length} selected
                </div>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="results-action-button bg-blue-600 hover:bg-blue-700" disabled={diffMode || searchResults.results.length === 0}>
                      Selection
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <Tooltip title={tooltipText.results.selectAll} placement="right">
                      <DropdownMenuItem
                        disabled={diffMode || !buttonState.showSelectAll}
                        onClick={handleSelectAll}
                      >
                        Select all papers
                      </DropdownMenuItem>
                    </Tooltip>
                    <Tooltip title={tooltipText.results.deselectAll} placement="right">
                      <DropdownMenuItem
                        disabled={diffMode || selectedPapers.length === 0}
                        onClick={handleDeselectAll}
                      >
                        Clear selection
                      </DropdownMenuItem>
                    </Tooltip>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button className="results-action-button bg-green-600 hover:bg-green-700">
                      View
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem
                      disabled={!buttonState.showHideMetadata}
                      onClick={handleShowMetadata}
                    >
                      {showMetadata ? "Hide metadata" : "Show metadata"}
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={handleShowFilters}>
                      {showFilters ? "Hide filters" : "Show filters"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <PaperOperations
                  selectedPapers={selectedPapers}
                  currentSearchReferenceId={searchHistory[currentSearchHistoryIndex]?.id ?? ""}
                  searchResults={searchResults}
                  setSearchResults={setSearchResults}
                  buttonState={buttonState}
                  setButtonState={setButtonState}
                  diffMode={diffMode}

                  llmOptions={llmOptions}
                  llmQuestions={llmQuestions}
                  llmAnswers={llmAnswers}
                  setLLMOptions={setLLMOptions}
                  setLLMQuestions={setLLMQuestions}
                  setLLMAnswers={setLLMAnswers}
                />
                <ExportDropdown
                  selectedPapers={selectedPapers}
                  buttonState={buttonState}
                  diffMode={diffMode}
                  currentSearchReferenceId={searchHistory[currentSearchHistoryIndex]?.id ?? ""}
                />
              </div>
              {/* Filters */}
              {
                showFilters &&
                <div className="flex flex-col gap-y-2 border p-2 bg-white">
                  <InputLabel tooltip="" label="Filters"/>
                  <div className="row px-3 gap-y-2">
                    <div className="col-6 p-0">
                      <MultiSelect
                        placeholder='Search Engines'
                        options={
                          Array.from(new Set(
                            searchResults.results
                              .filter((result) => result.searched_from !== undefined)
                              .flatMap((result) => result.searched_from)
                          )).map((searchEngine) => ({ label: searchEngine!, value: searchEngine! }))
                        }
                        value={filterForm.searchEngines}
                        onValueChange={(value) => {
                          setFilterForm({...filterForm, searchEngines: value})}
                        }
                      />
                    </div>
                    <div className="col-6 p-0">
                      <MultiSelect
                        placeholder="Conference"
                        options={
                          Array.from(new Set(
                            searchResults.results
                              .flatMap((result) => result.conference_journal)
                              .filter((conference) => conference !== undefined)  
                          ))
                          .map((conference) => ({ label: conference, value: conference }))
                        }
                        maxCount={2}
                        value={filterForm.conference}
                        onValueChange={(value) => {
                          setFilterForm((prevFilterForm) => ({...prevFilterForm, conference: value}))
                        }}
                      />
                    </div>
                    <div className='grid-cols-6 p-0 flex flex-wrap items-center'>
                      <InputLabel tooltip={tooltipText.search.database} label="From" />
                      <DatePicker
                        date={filterForm.dateRange.start}
                        setDate={(date) => setFilterForm((prevFilterForm) => ({
                          ...prevFilterForm,
                          dateRange: { ...prevFilterForm.dateRange, start: date }
                        }))}
                      />
                      <InputLabel tooltip={tooltipText.search.database} label="To"/>
                        <DatePicker
                          date={filterForm.dateRange.end}
                          setDate={(date) => setFilterForm((prevFilterForm) => ({
                            ...prevFilterForm,
                            dateRange: { ...prevFilterForm.dateRange, end: date }
                          }))}
                        />
                    </div>
                    <div>
                      <MultiSelect 
                        placeholder="LLM Questions"
                        options={
                          llmQuestions.map((llmQuestion) => {
                            const questionId = String(llmQuestion.id)
                            let label = `Question ${questionId}`
                            if (llmQuestion.question) {
                              label += " - " + llmQuestion.question;
                            }
                            return { label: label, value: questionId }
                          })
                        }
                        value={filterForm.llmQuestions}
                        onValueChange={(value) => {
                          const answers = [...filterForm.llmAnswers];
                          llmQuestions.forEach((llmQuestion) => {
                            if (value.includes(String(llmQuestion.id))) {
                              answers[llmQuestion.id] = answers[llmQuestion.id] ?? [];
                            } else {
                              answers[llmQuestion.id] = [];
                            }
                          });
                            
                          setFilterForm({
                            ...filterForm, 
                            llmQuestions: value,
                            llmAnswers: answers
                          })
                        }}
                      />
                    </div>
                    {
                      filterForm.llmQuestions.map((questionId) => {
                        try {
                          const currentQuestionPossibleAnswers = 
                            llmQuestions.find((llmQuestion) => llmQuestion.id === parseInt(questionId))?.answer.split(",") ?? [];
                          const possibleAnswers = 
                            currentQuestionPossibleAnswers.map((answer) => ({ label: answer, value: answer }));
                          return (
                            <MultiSelect
                              key={questionId}
                              placeholder={`LLM Question ${questionId}`}
                              options={possibleAnswers}
                              value={filterForm.llmAnswers[Number(questionId)] ?? []}
                              onValueChange={(value) => {
                                const newAnswers = [...filterForm.llmAnswers];
                                newAnswers[Number(questionId)] = value;
                                setFilterForm({...filterForm, llmAnswers: newAnswers});
                              }}
                            />
                          )
                        } catch (e) {
                          toast.error(`Error parsing LLM Question ${questionId} answers - ${e}`);
                        }
                    })}
                  </div>
                  <Button 
                    className="bg-blue-500 hover:bg-blue-600"
                    onClick={applyFilters}>
                    Apply Filters
                  </Button>
                </div>
              }
            </div>
            
            {
              diffMode &&
              <>
                <div className="search-results row">
                  <div className="col-6">
                    <SearchHistoryHeaderCard 
                      index={currentSearchHistoryIndex}
                      diffIndex={diffSearchHistoryIndex ?? -1}
                      searchHistory={searchHistory}
                      format="remove"
                    />
                  </div>
                  <div className="col-6">
                    <SearchHistoryHeaderCard 
                      index={diffSearchHistoryIndex ?? -1}
                      diffIndex={currentSearchHistoryIndex}
                      searchHistory={searchHistory} 
                      format="add"
                    />
                  </div>
                </div>
              </>
            }

            {/* Table data */}
            <div className="search-results row" style={{ height: "80%" }}>
              {/* Main #1 */}
              <div
                id="publication-data-table-main"
                className='publication-data-table main-data-table h-[100%]'
                ref={mainDataTableRef}
                onScroll={() => handleScroll(mainDataTableRef.current, diffDataTableRef.current)}
              >
                  <PublicationTable
                    searchResults={searchResults}
                    setSearchResults={setSearchResults}
                    selectedPapers={selectedPapers}
                    handlePaperSelect={handlePaperSelect}
                    showMetadata={showMetadata}
                    llmQuestions={llmQuestions}
                    currentSearchReferenceId={searchHistory[currentSearchHistoryIndex]?.id ?? ""}
                    diffMode={diffMode}
                  />
              </div>
              {/* Diff #2 */}
              {
                diffMode && diffSearchHistoryIndex !== null &&
                <div
                  id="publication-data-table-diff"
                  className="publication-data-table diff-data-table col-6 border h-100"
                  ref={diffDataTableRef}
                  onScroll={() => handleScroll(diffDataTableRef.current, mainDataTableRef.current)}
                >
                  <PublicationTable 
                    searchResults={diffSearchResults} 
                    showMetadata={showMetadata}
                  /> 
                </div> 
              }
              {
                diffMode && diffSearchHistoryIndex === null &&
                <div id="publication-data-table-diff-empty" className="publication-data-table diff-data-table col-6 border h-100">
                  <div className="flex justify-content-center align-items-center h-100">
                    <div className="text-muted">No chosen search to compare</div>
                  </div>
                </div>
              }
            </div>
          </div>
        </section>
      </div>
  )
}

export default App
