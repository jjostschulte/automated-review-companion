import { handleError } from '@/common/handler';
// import '@/main.css';
import { parseAuthors } from '@/common/labels';
import { BASE_URL } from '@/utils/common';
import { sanitizeTitleHtml } from '@/utils/sanitize';
import {
  ExpandLess as ExpandLessIcon,
  ExpandMore as ExpandMoreIcon
} from '@mui/icons-material';
import { Tooltip } from '@mui/material';
import axios from 'axios';
import { Fragment, useEffect } from 'react';
import {
  Author,
  LLMQuestion,
  Publication,
  SearchResult
} from '../types';

export interface PublicationRowProps {
  rowType?: string
  rowIdx?: number | string
  publication: Publication
  handlePaperSelect?: (paper_id: string) => void
  selectedPapers?: string[]
  showMetadata?: boolean
  searchResults: SearchResult
  setSearchResults?: React.Dispatch<React.SetStateAction<SearchResult>>
  llmQuestions?: LLMQuestion[]
  currentSearchReferenceId?: string
  diffMode?: boolean
}

export type MetadataColumnType = {
  headerName: string
  field: keyof Publication
  placeholder: string
  render?: (value: Publication[keyof Publication]) => JSX.Element
}

const PublicationRow: React.FC<PublicationRowProps> = (props) => {
  const { 
    rowType, rowIdx,
    publication,
    handlePaperSelect,
    selectedPapers,
    showMetadata,
    searchResults, setSearchResults,
    llmQuestions,
    currentSearchReferenceId,
    diffMode,
  } = props;

  const metadataColumns: MetadataColumnType[] = [
    {
      headerName: 'Abstract',
      field: 'abstract',
      placeholder: '-',
    },
    {
      headerName: 'Authors',
      field: 'authors',
      placeholder: '-',
    render: (value) => {
      return (
        <div className='max-w-[200px] overflow-auto'>
          {parseAuthors(value as Author[])}
        </div>
      )
    }
    },
    {
      headerName: 'Citation Count',
      field: 'citation_count',
      placeholder: '-',
    },
    {
      headerName: 'Conference/Journal',
      field: 'conference_journal',
      placeholder: '-',
    },
    {
      headerName: 'DOI',
      field: 'doi',
      placeholder: 'Not Available',
    },
    {
      headerName: 'Publication Date',
      field: 'publication_date',
      placeholder: '-',
    },
    {
      headerName: 'Publication Type',
      field: 'publication_type',
      placeholder: '-',
    },
    {
      headerName: 'Publisher',
      field: 'publisher',
      placeholder: '-',
    },
    {
      headerName: 'Semantic Scholar URL',
      field: 'semantic_scholar_url',
      placeholder: '-',
      render: (value) => {
        const url = typeof value === 'string' ? value : '';
        if (url === '') {
          return <div>-</div>
        } 
        return (
          <a href={url} className='text-blue-500 underline' target="_blank" rel="noopener noreferrer">
            View on Semantic Scholar
          </a>
        )
      }
    }
  ]

  const getColorByRowType = () => {
    switch (rowType) {
      case 'reference':
        return 'table-warning';
      case 'citation':
        return 'table-info';
      default:
        return '';
    }
  }

  const getDiffRowColor = () => {
    switch (publication.diffType) {
      case 'add':
        return 'table-row-red bg-[#FFEEF0]';
      case 'remove':
        return 'table-row-green bg-[#E6FFED]';
      case 'none':
        return 'table-row-none bg-black';
      default:
        return '';
    }
  }

  const handleReferencesVisibility = () => {
    if (!setSearchResults) return;
    const updatedResults = searchResults.results.map((result: Publication) => {
      if (result.paper_id === publication.paper_id) {
        return {
          ...result,
          showReferences: !result.showReferences
        }
      }
      return result;
    });
    setSearchResults({...searchResults, results: updatedResults})
  }

  const handleCitationsVisibility = () => {
    if (!setSearchResults) return;
    const updatedResults = searchResults.results.map((result: Publication) => {
      if (result.paper_id === publication.paper_id) {
        return {
          ...result,
          showCitations: !result.showCitations
        }
      }
      return result;
    });
    setSearchResults({...searchResults, results: updatedResults})
  }

  const turnReferencesAndCitationsInvisible = () => {
    if (!setSearchResults) return;
    const updatedResults = searchResults.results.map((result: Publication) => {
      return {
        ...result,
        showReferences: false,
        showCitations: false
      }
    });
    setSearchResults({...searchResults, results: updatedResults})
  }

  // Only applicable to references/citations
  const addToMainSearchResult = async (paper: Publication) => {
    if (!setSearchResults) return;
    // remove from references/citations from all results' citations/references
    await axios.put(
      `${BASE_URL}/scraper/history/publications?search_reference_id=${currentSearchReferenceId}`, 
      { papers: [paper] }
    )
    .then((res) => {
      console.log(res.data);
      const updatedResults = searchResults.results.map((result: Publication) => {
        let references: Publication[] = [];
        let citations: Publication[] = [];
        if (result.references && result.references.length > 0) {
          references = result.references.filter((reference) => reference.paper_id !== paper.paper_id)
        }
        if (result.citations && result.citations.length > 0) {
            citations = result.citations.filter((citation) => citation.paper_id !== paper.paper_id)
        }
        return {
          ...result,
          references,
          citations
        }
      });
      setSearchResults({...searchResults, results: [...updatedResults, paper]})
    })
    .catch(handleError);
  }

  const parseSearchString = (searchString: string[] | string) => {
    if (Array.isArray(searchString)) {
      return `(${searchString.join(', ')})`;
    }
    return searchString
  }

  useEffect(() => {
    if (diffMode) { turnReferencesAndCitationsInvisible(); }
  }, [diffMode]);

  return (
      <tr 
        key={publication.paper_id}
        className={`${getColorByRowType()} ${getDiffRowColor()} publication-row`}
      >
        <td>
          <div className='d-flex items-align-center flex-column gap-2 h-100 w-100'>
            {
                rowType === 'reference' && !diffMode &&
                <Tooltip title="Append to the bottom of the main search results" placement="top">
                  <button
                      className="btn btn-primary btn-sm"
                      onClick={() => addToMainSearchResult(publication)}
                  >+
                  </button>
                </Tooltip>
            }
            {
                rowType === 'citation' && !diffMode &&
                <Tooltip title="Append to the bottom of the main search results" placement="top">
                  <button
                      className="btn btn-primary btn-sm"
                      onClick={() => addToMainSearchResult(publication)}
                  >+
                  </button>
                </Tooltip>
            }
            {
                rowType === 'main' && selectedPapers && handlePaperSelect && !diffMode &&
                <>
                  <input
                      type="checkbox"
                      checked={selectedPapers.includes(publication.paper_id)}
                      onChange={() => handlePaperSelect(publication.paper_id)}
                  />
                  {/* Expand/contract references/citations */}
                  {
                      publication.references && publication.references.length > 0 && !diffMode &&
                      <Tooltip title="Expand/Collapse references" placement="top">
                        {publication.showReferences ?
                            <ExpandLessIcon
                                onClick={handleReferencesVisibility}
                                style={{
                                  cursor: "pointer",
                                  color: "#E6A23B"
                                }} /> 
                          : <ExpandMoreIcon
                                onClick={handleReferencesVisibility}
                                style={{
                                  cursor: "pointer",
                                  color: "#E6A23B"
                                }}
                            />}
                      </Tooltip>
                  }
                  {
                      publication.citations && publication.citations.length > 0 && !diffMode &&
                      <Tooltip title="Expand/Collapse citations" placement="top">
                        {publication.showCitations ?
                            <ExpandLessIcon
                                onClick={handleCitationsVisibility}
                                style={{
                                  cursor: "pointer",
                                  color: "blue"
                                }}
                            /> :
                            <ExpandMoreIcon
                                onClick={handleCitationsVisibility}
                                style={{
                                  cursor: "pointer",
                                  color: "blue"
                                }}
                            />
                        }
                      </Tooltip>
                  }
                </>
            }
          </div>
        </td>
        <td>
          {rowIdx}
        </td>
        <td>
          <a
            href={publication.paper_id.slice(4)}
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-500 underline"
          >
            {publication.paper_id.slice(4).length > 30
              ? publication.paper_id.slice(4, 34) + "..."
              : publication.paper_id.slice(4)}
          </a>
        </td>
        <td>
          <div style={{width: "300px", height: "150px", overflow: "auto"}}>
            <span dangerouslySetInnerHTML={{__html: sanitizeTitleHtml(publication.paper_title)}}></span>
          </div>
        </td>
        <td>{publication.searched_from}</td>
        <td>
          <div className="w-[300px]">
            <code>
              {parseSearchString(publication.search_string)}
            </code>
          </div>
        </td>
        <td>
          <code>
            {publication.formatted_search_string}
          </code>
        </td>

        {/* Metadata */}
        {
            showMetadata &&
            <>
              {
                metadataColumns.map((column) => (
                  <td key={column.field}>
                    <div className="min-w-[200px] overflow-auto" style={{ height: "150px" }}>
                      {
                        column.render 
                        ? column.render((publication[column.field] as string)) 
                        : (publication[column.field] as string) ?? column.placeholder
                      }
                    </div>
                  </td>
                ))
              }
            </>
        }

        {/* Questions */}
        {
            searchResults.results && searchResults.results.length > 0 &&
            searchResults.results.some((result) => result.llm_responses && result.llm_responses.length > 0) &&
            llmQuestions && llmQuestions.length > 0 && llmQuestions.map((response: LLMQuestion, index: number) => (
                <Fragment key={response.id}>
                  <td style={{minWidth: "220px"}}>
                    {typeof publication.llm_responses === 'undefined' ? "-" : publication.llm_responses[index]?.answer ?? "-"}
                  </td>
                  <td style={{minWidth: "220px"}}>
                    {typeof publication.llm_responses === 'undefined' ? "-" : publication.llm_responses[index]?.rationale ?? "-"}
                  </td>
                </Fragment>
            ))
        }
      </tr>
  )

}

export default PublicationRow;
