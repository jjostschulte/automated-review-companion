import { LLMQuestion, SearchResult } from "@/types";
import { Fragment, useRef, useState } from "react";
import '../main.css';
import PublicationRow from "./PublicationRow";

export interface PublicationTableProps {
  searchResults: SearchResult;
  setSearchResults?: React.Dispatch<React.SetStateAction<SearchResult>>;
  selectedPapers?: string[];
  handlePaperSelect?: (paperId: string) => void;
  showMetadata?: boolean;
  llmQuestions?: LLMQuestion[];
  currentSearchReferenceId?: string;
  diffMode?: boolean;
}

const PublicationTable: React.FC<PublicationTableProps> = (props) => {
  
  const {
    searchResults,
    setSearchResults,
    selectedPapers,
    handlePaperSelect,
    showMetadata,
    llmQuestions,
    currentSearchReferenceId,
    diffMode,
  } = props;

  // Publication Data Table Resizability
  const [columns, setColumns] = useState([
    {
      name: "Paper ID",
      width: 200,
      requirement: true
    },
    {
      name: "Title",
      width: 200,
      requirement: true
    },
    {
      name: "Source",
      width: 100,
      requirement: true
    },
    {
      name: "Search String",
      width: 250,
      requirement: true
    },
    {
      name: "Formatted Search String",
      width: 250,
      requirement: true
    },
    {
      name: "Abstract",
      style: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      },
      width: 550,
      requirement: "showMetadata"
    },
    {
      name: "Authors",
      width: 220,
      requirement: "showMetadata"
    },
    {
      name: "Citations Count",
      width: 150,
      requirement: "showMetadata"
    },
    {
      name: "Conference/Journal",
      width: 200,
      requirement: "showMetadata"
    },
    {
      name: "DOI",
      width: 100,
      requirement: "showMetadata"
    },
    {
      name: "Publication Date",
      width: 150,
      requirement: "showMetadata"
    },
    {
      name: "Publication Type",
      width: 150,
      requirement: "showMetadata"
    },
    {
      name: "Publisher",
      width: 100,
      requirement: "showMetadata"
    },
    {
      name: "Semantic Scholar URL",
      width: 200,
      requirement: "showMetadata"
    }
  ]);


  const tableRef = useRef<HTMLTableElement>(null);
  const startResizing = (index: number, startX: number) => {
    const doDrag = (e: MouseEvent) => {
      const dx = e.clientX - startX;
      if (tableRef.current) {
        const newWidths = [...columns];
        newWidths[index].width += dx;
        setColumns(newWidths);
      }
      startX = e.clientX;
    }

    const stopDrag = () => {
      document.removeEventListener("mousemove", doDrag);
      document.removeEventListener("mouseup", stopDrag);
    }

    document.addEventListener("mousemove", doDrag);
    document.addEventListener("mouseup", stopDrag);
  }

  const checkColumnRequirement = (requirement: boolean | string) => {
    if (requirement === true) {
      return true;
    } else if (requirement === "showMetadata") {
      return showMetadata;
    }
    return false
  }

  const visibleColumns = columns
    .map((column, index) => ({ column, index }))
    .filter(({ column }) => checkColumnRequirement(column.requirement));
  const showLLMColumns = Boolean(
    searchResults.results &&
    searchResults.results.length > 0 &&
    searchResults.results.some((result) => result.llm_responses && result.llm_responses.length > 0) &&
    llmQuestions &&
    llmQuestions.length > 0
  );
  const visibleResultCount = searchResults?.results?.filter((result) => result.show === undefined || result.show).length ?? 0;
  const emptyStateColSpan = 2 + visibleColumns.length + (showLLMColumns ? (llmQuestions?.length ?? 0) * 2 : 0);

  return ( 
    <>
     <div className="table-container">
        <table className="table border-1 border-slate-600 bg-white publication-table" ref={tableRef}>
          <thead className='bg-primary bg-black text-white sticky-top' style={{ height: "20px" }}>
            <tr>
              <td style={{ minWidth: "10px" }}></td>
              <td style={{ minWidth: "70px" }}>#</td>
              {
                visibleColumns.map(({ column, index }) => (
                  <td
                    key={column.name}
                    className="resizable leading-[14px]"
                    style={{  minWidth: column.width + "px", ...column.style}}
                  >
                    {column.name}
                    <div className="resizer" onMouseDown={(e) => startResizing(index, e.clientX)} style={{ cursor: "col-resize" }}></div>
                  </td>
                ))
              }

              {/* Questions */}
              {
                  showLLMColumns && llmQuestions && llmQuestions.map((response: LLMQuestion, index) => (
                      <Fragment key={response.id}>
                        <td style={{minWidth: "220px"}}>Q{index + 1}: "{response.question}"</td>
                        <td style={{minWidth: "220px"}}>Q{index + 1}: "{response.question}" Rationale</td>
                      </Fragment>
                  ))
              }
            </tr>
          </thead>
          <tbody>
          {visibleResultCount === 0 && (
            <tr>
              <td colSpan={emptyStateColSpan} className="publication-table-empty">
                <div className="publication-table-empty-content">
                  No publications to display.
                </div>
              </td>
            </tr>
          )}
          {searchResults?.results && searchResults.results.length > 0 && searchResults.results.map((result, rowIdx) => {

            const publicationRows = [];

            if (result.show == undefined || result.show) {
              publicationRows.push(
                <PublicationRow
                  key={rowIdx}
                  rowType='main'
                  rowIdx={rowIdx+1}
                  publication={result}
                  handlePaperSelect={handlePaperSelect}
                  selectedPapers={selectedPapers}
                  showMetadata={showMetadata}
                  searchResults={searchResults}
                  llmQuestions={llmQuestions}
                  setSearchResults={setSearchResults}
                  currentSearchReferenceId={currentSearchReferenceId}
                  diffMode={diffMode}
                />
              )
            }

            if (result.showReferences && result.references !== undefined && result.references?.length > 0) {
              result.references.forEach((reference, referenceIdx) => {
                publicationRows.push(
                  <PublicationRow
                    rowType="reference"
                    rowIdx={rowIdx+1 + "-R" + referenceIdx}
                    publication={reference}
                    handlePaperSelect={handlePaperSelect}
                    selectedPapers={selectedPapers}
                    showMetadata={showMetadata}
                    searchResults={searchResults}
                    llmQuestions={llmQuestions}
                    setSearchResults={setSearchResults}
                    currentSearchReferenceId={currentSearchReferenceId}
                    diffMode={diffMode}
                  />
                )
              })
            }


            if (result.showCitations && result.citations !== undefined && result.citations?.length > 0) {
              result.citations.forEach((citation, citationIdx) => {
                publicationRows.push(
                  <PublicationRow
                    rowType="citation"
                    rowIdx={rowIdx+1 + "-C" + citationIdx}
                    publication={citation}
                    handlePaperSelect={handlePaperSelect}
                    selectedPapers={selectedPapers}
                    showMetadata={showMetadata}
                    searchResults={searchResults}
                    llmQuestions={llmQuestions}
                    setSearchResults={setSearchResults}
                    currentSearchReferenceId={currentSearchReferenceId}
                    diffMode={diffMode}
                  />
                )
              })
            }
            return publicationRows;
          })}
          </tbody>
        </table>    
      </div>
    </>
   );
}
 
export default PublicationTable;
