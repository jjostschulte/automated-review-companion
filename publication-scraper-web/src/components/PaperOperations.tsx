import {
    ButtonState,
    LLMOptions,
    LLMPaperFilterResponse,
    LLMQuestion,
    LLMUserAnswer,
    Publication,
    PublicationOperation,
    SearchResult,
    SnowballingSearch
} from "@/types";
import AddIcon from '@mui/icons-material/Add';
import CloseIcon from '@mui/icons-material/Close';
import DeleteIcon from "@mui/icons-material/Delete";
import FilterAltIcon from '@mui/icons-material/FilterAlt';
import InfoIcon from '@mui/icons-material/Info';
import KeyboardArrowLeftIcon from "@mui/icons-material/KeyboardArrowLeft";
import KeyboardArrowRightIcon from "@mui/icons-material/KeyboardArrowRight";
import ScreenSearchDesktopIcon from "@mui/icons-material/ScreenSearchDesktop";
import { Checkbox } from "./ui/checkbox";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
    DialogTrigger
} from "./ui/dialog";

import { handleError } from "@/common/handler";
import { parseAuthors } from "@/common/labels";
import { tooltipText } from "@/data/tooltip";
import { cn } from "@/lib/utils";
import { BASE_URL } from "@/utils/common";
import { IconButton, Tooltip } from "@mui/material";
import axios from "axios";
import { ChangeEvent, useEffect, useState } from "react";
import { toast } from "react-toastify";
import Spinner from "./Spinner";
import { Button } from "./ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";
import { Input } from "./ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";

type LLMFilterProgress = {
    completed: number;
    total: number;
    current_paper_id?: string;
    status: "idle" | "queued" | "running" | "completed" | "failed" | "unknown";
}

const MAX_LLM_QUESTIONS = 9;
const MAX_LLM_FILTER_PAPERS = 100;

export interface PaperOperationsProps {
    selectedPapers: string[],
    currentSearchReferenceId: string,
    searchResults: SearchResult,
    setSearchResults: React.Dispatch<React.SetStateAction<SearchResult>>,
    buttonState: ButtonState,
    setButtonState: React.Dispatch<React.SetStateAction<ButtonState>>
    diffMode: boolean;

    llmQuestions: LLMQuestion[],
    llmOptions: LLMOptions,
    llmAnswers: LLMUserAnswer[],
    setLLMQuestions: React.Dispatch<React.SetStateAction<LLMQuestion[]>>,
    setLLMOptions: React.Dispatch<React.SetStateAction<LLMOptions>>,
    setLLMAnswers: React.Dispatch<React.SetStateAction<LLMUserAnswer[]>>,
}

const PaperOperations: React.FC<PaperOperationsProps> = (props) => {
    const {
        selectedPapers,
        currentSearchReferenceId,
        buttonState, setButtonState,
        searchResults, setSearchResults,
        diffMode,
        llmQuestions, llmOptions, llmAnswers,
        setLLMQuestions, setLLMOptions, setLLMAnswers
    } = props

    const isPaperOperationsDisabled = selectedPapers.length === 0 || diffMode;
    const [showDialogPrompt, setShowDialogPrompt] = useState<PublicationOperation | null>(null);
    const [snowballingType, setSnowballingType] = useState<string>('');
    const [isPerformingOperation, setIsPerformingOperation] = useState<boolean>(false);
    const [isLLMFilterProcessing, setIsLLMFilterProcessing] = useState(false);
    const [llmExamplePaperIds, setLLMExamplePaperIds] = useState<string[]>([]);
    const [llmProgressId, setLLMProgressId] = useState<string>("");
    const [llmProgress, setLLMProgress] = useState<LLMFilterProgress>({
        completed: 0,
        total: 0,
        current_paper_id: "",
        status: "idle",
    });

    const operations = [
        {
            icon: <ScreenSearchDesktopIcon fontSize='small' className="me-1"/>,
            label: 'Populate Metadata',
            operation: PublicationOperation.POPULATE_METADATA
        },
        {
            icon: <KeyboardArrowRightIcon fontSize='small' className="me-1"/>,
            label: 'Forward Search',
            operation: PublicationOperation.FORWARD_SEARCH
        },
        {
            icon: <KeyboardArrowLeftIcon fontSize='small' className="me-1"/>,
            label: 'Backward Search',
            operation: PublicationOperation.BACKWARD_SEARCH
        },
        {
            icon: <FilterAltIcon fontSize='small' className="me-1"/>,
            label: "LLM-Powered Filter",
            operation: PublicationOperation.LLM_FILTER
        },
        {
            icon: <DeleteIcon fontSize='small' className="me-1"/>,
            label: 'Delete',
            operation: PublicationOperation.DELETE
        }
    ]

    const isOperationDisabled = (operation: PublicationOperation) => {
        switch (operation) {
            case PublicationOperation.POPULATE_METADATA:
                return !buttonState.showPopulateMetadata
            case PublicationOperation.FORWARD_SEARCH:
                return !buttonState.showForwardSearch
            case PublicationOperation.BACKWARD_SEARCH:
                return !buttonState.showBackwardSearch
            case PublicationOperation.DELETE:
                return searchResults.results.length === 0
            default:
                return false
        }
    }

    const handleOperationDialog = (operation: PublicationOperation) => {
        return () => setShowDialogPrompt(operation);
    }

    const handleOperation = (operation: PublicationOperation) => {
        return async () => {
            switch (operation) {
                case PublicationOperation.POPULATE_METADATA:
                    await populateMetadata();
                    break
                case PublicationOperation.FORWARD_SEARCH:
                    await handleSnowballing("forward");
                    break
                case PublicationOperation.BACKWARD_SEARCH:
                    await handleSnowballing("backward");
                    break
                case PublicationOperation.DELETE:
                    handleDeletePapers();
                    break
                default:
                    break
            }
        }
    }

    const getDialogTitle = () => {
        switch (showDialogPrompt) {
            case PublicationOperation.POPULATE_METADATA:
                return "Populate Metadata"
            case PublicationOperation.FORWARD_SEARCH:
                return "Forward Search"
            case PublicationOperation.BACKWARD_SEARCH:
                return "Backward Search"
            case PublicationOperation.DELETE:
                return "Delete"
            default:
                return ""
        }
    }

    const getDialogDescription = (selectedPapersCount: number) => {
        switch (showDialogPrompt) {
            case PublicationOperation.POPULATE_METADATA:
                return `Populate metadata for ${selectedPapersCount} papers`
            case PublicationOperation.FORWARD_SEARCH:
                return `Forward search for ${selectedPapersCount} papers`
            case PublicationOperation.BACKWARD_SEARCH:
                return `Backward search for ${selectedPapersCount} papers`
            case PublicationOperation.DELETE:
                return `Delete ${selectedPapersCount} papers`
            default:
                return
        }
    }

    const populateMetadata = async () => {
        setIsPerformingOperation(true);
        await axios.post(`${BASE_URL}/scraper/publication-metadata`, {
            paper_ids: selectedPapers,
            search_reference_id: currentSearchReferenceId
        })
            .then((res) => {
                const data = res.data;
                const metadataItems = Array.isArray(data.metadata) ? data.metadata : [];
                const updatedResults = searchResults.results.map((result: Publication) => {
                    const metadata = metadataItems.find((metadata: Publication) => metadata.paper_id === result.paper_id);
                    if (!metadata) return result;

                    return {
                        ...result,
                        ...metadata,
                        searched_from: result.searched_from || metadata.searched_from,
                        search_string: result.search_string || metadata.search_string,
                        formatted_search_string: result.formatted_search_string || metadata.formatted_search_string,
                    }
                });
                setSearchResults({...searchResults, results: updatedResults})
                setButtonState((prevState) => ({
                    ...prevState,
                    showLLMQuestions: true,
                    showExport: true,
                }))
                toast.success('Metadata populated successfully');
            })
            .catch((error) => {
                setLLMProgress((prevProgress) => ({
                    ...prevProgress,
                    current_paper_id: "",
                    status: "failed",
                }));
                handleError(error);
            })
            .finally(() => {
                setIsPerformingOperation(false);
                setShowDialogPrompt(null);
            });
    }

    const matchDOIs = (originalDOI: string, toMatchDoi: string) => {
        return originalDOI.toLowerCase().includes(toMatchDoi.toLowerCase())
    }

    const handleSnowballing = async (searchType: string) => {
        if (snowballingType) return;
        setSnowballingType(searchType);
        setIsPerformingOperation(true);
        await axios.post(`${BASE_URL}/publication/snowballing`, {
            publication_ids: selectedPapers,
            search_type: searchType,
            show_metadata: true
        })
            .then((res) => {
                const _searchType = searchType.charAt(0).toUpperCase() + searchType.slice(1);
                toast.info(`${_searchType} snowballing search completed`);

                if (searchType === "backward") {
                    const updatedResults = [...searchResults.results];
                    res.data.results.forEach((result: SnowballingSearch) => {
                        const index = updatedResults.findIndex((r) => matchDOIs(r.paper_id, result.paper_id));
                        if (index !== -1) {
                            updatedResults[index].references = result.references;
                            updatedResults[index].showReferences = true;
                        }
                    });
                    setSearchResults({...searchResults, results: updatedResults})
                } else if (searchType === "forward") {
                    const updatedResults = [...searchResults.results];
                    res.data.results.forEach((result: SnowballingSearch) => {
                        const index = updatedResults.findIndex((r) => matchDOIs(r.paper_id, result.paper_id));
                        if (index !== -1) {
                            updatedResults[index].citations = result.citations;
                            updatedResults[index].showCitations = true;
                        }
                    });
                    setSearchResults({...searchResults, results: updatedResults})
                }
            })
            .catch(handleError)
            .finally(() => {
                setSnowballingType('');
                setIsPerformingOperation(false);
                setShowDialogPrompt(null);
            });
    }

    const handleDeletePapers = async () => {
        // 1. Remove from search results
        // 2. Update search history in backend

        // update results to only include paper ids not in selectedPapers
        await axios.delete(`${BASE_URL}/scraper/history/publications`, {
            params: {
                search_reference_id: currentSearchReferenceId,
                paper_ids: selectedPapers.join(',')
            }
        })
            .then(() => {
                toast.success(`${selectedPapers.length} paper(s) deleted successfully`);
                const updatedResults = searchResults.results.filter((result: Publication) => !selectedPapers.includes(result.paper_id));
                setSearchResults({...searchResults, results: updatedResults})
            })
            .catch(handleError)
            .finally(() => setShowDialogPrompt(null));
    }

    const handleCloseDialog = () => {
        setShowDialogPrompt(null);
    }

    const createLLMProgressId = () => {
        if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
            return crypto.randomUUID();
        }
        return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    const handleLLMFiltering = async () => {
        if (!validateLLMQuestionSubmittability()) return;

        // Case 1: There are already examples generated

        // Case 2: No previous LLM filtering performed
        const paperIdsToFilter = processSelectedPapers(selectedPapers);
        const progressId = createLLMProgressId();
        const initialTotal = paperIdsToFilter.filter((paperId) => !llmExamplePaperIds.includes(paperId)).length;
        setLLMProgressId(progressId);
        setLLMProgress({
            completed: 0,
            total: initialTotal,
            current_paper_id: "",
            status: "queued",
        });
        setIsLLMFilterProcessing(true);
        await axios.post(`${BASE_URL}/publication/llm-filter`, {
            questions: llmQuestions,
            paper_ids: paperIdsToFilter,
            answers: llmAnswers,
            options: llmOptions,
            progress_id: progressId,
            search_reference_id: currentSearchReferenceId,
        })
            .then((res) => {
                // debugger;
                const data = res.data.results
                const updatedResults = searchResults.results.map((result: Publication) => {
                    const llm_responses = data.find((response: LLMPaperFilterResponse) => response.paper_id === result.paper_id)?.responses;
                    return {...result, llm_responses}
                });
                setSearchResults({...searchResults, results: updatedResults})
                setLLMProgress((prevProgress) => ({
                    ...prevProgress,
                    completed: prevProgress.total,
                    current_paper_id: "",
                    status: "completed",
                }));
                setShowDialogPrompt(null);
            })
            .catch(handleError)
            .finally(() => {
                setIsLLMFilterProcessing(false);
                setLLMProgressId("");
            });
    }

    const validateLLMQuestionSubmittability = () => {

        // Validate LLM questions
        let valid = true;
        for (let i = 0; i < llmQuestions.length; i++) {
            if (!llmQuestions[i].question) {
                valid = false;
                toast.error('Question is required');
                break;
            }
            if (getLLMQuestionAnswerOptions(llmQuestions[i].answer).length === 0) {
                valid = false;
                toast.error(`Answer options are required for question ${i + 1}.`);
                break;
            }
        }
        if (!valid) return false;

        if (llmOptions.includeExamples && llmExamplePaperIds.length === 0) {
            toast.error('Choose at least one example paper.');
            return false;
        }

        if (llmOptions.includeExamples) {
            const missingExampleLabels = llmExamplePapers.flatMap((paper) => {
                const paperAnswer = llmAnswers.find((answer) => answer.paper_id === paper.paper_id);
                return llmQuestions
                    .filter((_, questionIdx) => !paperAnswer?.responses[questionIdx]?.answer?.trim())
                    .map((question) => ({ paper, question }));
            });

            if (missingExampleLabels.length > 0) {
                const firstMissingLabel = missingExampleLabels[0];
                toast.error(`Choose an example answer for "${firstMissingLabel.paper.paper_title}" on question ${firstMissingLabel.question.id}.`);
                return false;
            }
        }

        // Validate Paper metadata
        const missingMetadataPapers: Publication[] = [];
        searchResults.results.forEach((result: Publication) => {
            if (selectedPapers.includes(result.paper_id) && !result.abstract) {
                valid = false;
                missingMetadataPapers.push(result);
            }
        });
        if (!valid) {
            toast.warn(`Metadata is missing for ${missingMetadataPapers.length} papers: ${missingMetadataPapers.map((paper) => paper.paper_id).join(', ')}`);
            valid = true;
            return valid;
        }

        // Validate selected papers
        if (selectedPapers.length > MAX_LLM_FILTER_PAPERS) {
            valid = false;
            toast.error(`Maximum of ${MAX_LLM_FILTER_PAPERS} selected papers allowed at once.`);
        }
        return valid;
    }

    /**
     * Returns a list of paper ids that have metadata available by examining the abstract field
     * @param selectedPapers paper ids selected by the user
     * @returns paper ids that have metadata available
     */
    const processSelectedPapers = (selectedPapers: string[]) => {
        const missingMetadataPapers: Publication[] = [];
        searchResults.results.forEach((result: Publication) => {
            if (selectedPapers.includes(result.paper_id) && !result.abstract) {
                missingMetadataPapers.push(result);
            }
        });
        return selectedPapers.filter((paper_id) => !missingMetadataPapers.map((paper) => paper.paper_id).includes(paper_id));
    }

    const selectedPaperRecords = selectedPapers
        .map((paperId) => searchResults.results.find((result) => result.paper_id === paperId))
        .filter((paper): paper is Publication => Boolean(paper));

    const llmExamplePapers = llmExamplePaperIds
        .map((paperId) => searchResults.results.find((result) => result.paper_id === paperId))
        .filter((paper): paper is Publication => Boolean(paper));

    const buildEmptyLLMResponses = () => llmQuestions.map((question) => ({
        id: question.id,
        answer: "",
        rationale: "",
    }));

    const syncExamplePaperAnswers = (paperIds: string[]) => {
        setLLMAnswers((prevAnswers) =>
            paperIds.map((paperId) => {
                const existingAnswer = prevAnswers.find((answer) => answer.paper_id === paperId);
                return existingAnswer ?? {
                    paper_id: paperId,
                    responses: buildEmptyLLMResponses(),
                };
            })
        );
    }

    const handleToggleLLMExamplePaper = (paperId: string, checked: string | boolean) => {
        const shouldIncludePaper = checked === true;
        let nextExamplePaperIds = llmExamplePaperIds;

        if (shouldIncludePaper) {
            if (llmExamplePaperIds.includes(paperId)) return;
            nextExamplePaperIds = [...llmExamplePaperIds, paperId];
        } else {
            nextExamplePaperIds = llmExamplePaperIds.filter((id) => id !== paperId);
        }

        setLLMExamplePaperIds(nextExamplePaperIds);
        syncExamplePaperAnswers(nextExamplePaperIds);
    }

    const updateLLMAnswer = (paperId: string, questionIdx: number, field: "answer" | "rationale", value: string) => {
        const updatedAnswers = [...llmAnswers];
        let answerIdx = updatedAnswers.findIndex((answer) => answer.paper_id === paperId);

        if (answerIdx === -1) {
            updatedAnswers.push({
                paper_id: paperId,
                responses: buildEmptyLLMResponses(),
            });
            answerIdx = updatedAnswers.length - 1;
        }

        updatedAnswers[answerIdx].responses[questionIdx][field] = value;
        setLLMAnswers(updatedAnswers);
    }

    const getLLMQuestionAnswerOptions = (answer: string) => (
        Array.from(
            new Set(
                answer
                    .split(",")
                    .map((choice) => choice.trim())
                    .filter(Boolean)
            )
        )
    );

    useEffect(() => {
        setLLMExamplePaperIds((prevExamplePaperIds) => {
            const nextExamplePaperIds = prevExamplePaperIds.filter((paperId) => selectedPapers.includes(paperId));
            if (nextExamplePaperIds.length !== prevExamplePaperIds.length) {
                setLLMAnswers((prevAnswers) => prevAnswers.filter((answer) => nextExamplePaperIds.includes(answer.paper_id)));
            }
            return nextExamplePaperIds;
        });
    }, [selectedPapers, setLLMAnswers]);

    useEffect(() => {
        if (!isLLMFilterProcessing || !llmProgressId) return;

        const pollProgress = async () => {
            try {
                const response = await axios.get<LLMFilterProgress>(`${BASE_URL}/publication/llm-filter/progress/${llmProgressId}`);
                setLLMProgress(response.data);
            } catch {
                // Keep the main LLM request running even if one progress poll fails.
            }
        };

        pollProgress();
        const intervalId = window.setInterval(pollProgress, 1000);
        return () => window.clearInterval(intervalId);
    }, [isLLMFilterProcessing, llmProgressId]);


    const handleAddLLMQuestion = () => {
        if (llmQuestions.length >= MAX_LLM_QUESTIONS) {
            toast.info(`Maximum of ${MAX_LLM_QUESTIONS} questions allowed.`);
            return
        }
        setLLMQuestions([...llmQuestions, {
            id: llmQuestions.length + 1,
            question: '',
            answer: '',
            rationale: ''
        }])
        const newLLMAnswers = [...llmAnswers];
        newLLMAnswers.forEach((answer) => {
            answer.responses.push({
                id: llmQuestions.length + 1, 
                answer: "", 
                rationale: ""
            })
        })
        setLLMAnswers(newLLMAnswers);
    }

    const handleRemoveLLMQuestion = (question: LLMQuestion) => {
        if (llmQuestions.length === 1) {
            toast.info('At least one question is required');
            return;
        }
        const updatedQuestions = llmQuestions
            .filter((q) => q.id !== question.id)
            .map((q, index) => ({ ...q, id: index + 1 }));
        setLLMQuestions(updatedQuestions);

        // Remove the selected question from the answers
        const newLLMAnswers = [...llmAnswers];
        newLLMAnswers.forEach((answer) => {
            answer.responses = answer.responses.filter((response) => response.id !== question.id);
            answer.responses = answer.responses.map((response, index) => ({...response, id: index + 1}));
        });
        setLLMAnswers(newLLMAnswers);
    }

    const handleLLMQuestionChange = (e: ChangeEvent<HTMLInputElement>, question: LLMQuestion) => {
        const updatedQuestions = llmQuestions.map((q) => {
            if (q.id === question.id) return {...q, [e.target.name]: e.target.value}
            return q;
        })
        setLLMQuestions(updatedQuestions);
    }

    const handleLLMOptions = (checked: string | boolean, fieldName: string) => {
        const isChecked = checked === true;
        if (fieldName === "includeExamples" && isChecked) {
            setLLMExamplePaperIds([]);
            setLLMAnswers([]);
        }
        if (fieldName === "includeExamples" && !isChecked) {
            setLLMExamplePaperIds([]);
            setLLMAnswers([]);
            setLLMOptions({
                includeExamples: false,
                includeRationale: false,
            });
        } else {
            setLLMOptions({
                ...llmOptions,
                [fieldName]: isChecked,
            });
        }
    };

    const dropdownClasses = cn(
        "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium",
        "h-9 px-4 shadow-sm",
        "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
        "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
        "disabled:pointer-events-none disabled:border disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none",
        "dropdown-toggle hover:cursor-pointer",
    );

    const getLLMProgressText = () => {
        if (!isLLMFilterProcessing) return "";
        if (llmProgress.total === 0) {
            return llmProgress.status === "queued" ? "Preparing LLM filtering..." : "Waiting for progress...";
        }
        const clampedCompleted = Math.min(llmProgress.completed, llmProgress.total);
        const currentPaperText = llmProgress.current_paper_id
            ? ` Current: ${llmProgress.current_paper_id}`
            : "";
        return `Processed ${clampedCompleted}/${llmProgress.total} papers.${currentPaperText}`;
    };

    return (
        <>
            <Dialog
                open={showDialogPrompt !== null}
                // onOpenChange={handleCloseDialog}
                // className="w-full max-w-[425px]"
            >
                <DropdownMenu>
                    <Tooltip
                        title={isPaperOperationsDisabled ? tooltipText.results.operations.disabled : tooltipText.results.operations.enabled}
                        placement="bottom"
                    >
                        <span>
                            <DropdownMenuTrigger
                                disabled={isPaperOperationsDisabled}
                                className={dropdownClasses}
                            >
                                {/* <Button 
                                disabled={isPaperOperationsDisabled}
                                className="bg-slate-500 hover:bg-slate-600 active:border-none dropdown-toggle"
                                > */}
                                Paper Operations
                                {/* </Button> */}
                            </DropdownMenuTrigger>
                        </span>
                    </Tooltip>

                    <DropdownMenuContent>
                        {operations.map((operation, index) => (
                            <DialogTrigger asChild key={index}>
                                <Tooltip
                                    title={
                                        operation.operation === PublicationOperation.POPULATE_METADATA
                                            ? tooltipText.results.populateMetadata
                                            : operation.operation === PublicationOperation.FORWARD_SEARCH
                                            ? tooltipText.results.forwardSearch
                                            : operation.operation === PublicationOperation.BACKWARD_SEARCH
                                            ? tooltipText.results.backwardSearch
                                            : ""
                                    }
                                    placement="right-end"
                                >
                                    <DropdownMenuItem
                                        disabled={isOperationDisabled(operation.operation)}
                                        onClick={handleOperationDialog(operation.operation)}
                                    >
                                        {operation.icon}
                                        {operation.label}
                                    </DropdownMenuItem>
                                </Tooltip>
                            </DialogTrigger>
                        ))}
                    </DropdownMenuContent>
                </DropdownMenu>

                {
                    showDialogPrompt === PublicationOperation.LLM_FILTER &&
                    <DialogContent
                        className="max-w-fit max-h-full border overflow-auto"
                    >
                        <div className="container p-3 mt-3 border rounded" id="llm-questions">
                            <div className="flex flex-row justify-content-between align-items-center">
                                <div className="d-flex align-items-center justify-content-between gap-2">
                                    <DialogTitle>Paper Filter Questions (LLM-Powered)</DialogTitle>
                                    <DialogDescription className="sr-only">
                                        Configure LLM-powered paper filtering questions, answers, examples, and rationales.
                                    </DialogDescription>
                                    <div>
                                        <Tooltip title={tooltipText.search.llmQuestions} placement="top">
                                            <InfoIcon color="info"/>
                                        </Tooltip>
                                    </div>
                                </div>
                                <div className="flex flex-row gap-2 items-center">
                                    <div className="flex items-center space-x-2">
                                        <Checkbox id="llm-examples" checked={llmOptions.includeExamples}
                                                  onCheckedChange={(checked) => handleLLMOptions(checked, "includeExamples")}/>
                                        <label htmlFor="llm-examples"
                                               className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                            Include examples
                                        </label>
                                    </div>

                                    <div className="flex items-center space-x-2">
                                        <Checkbox id="llm-rationale" data-testid="llm-rationale"
                                                  checked={llmOptions.includeRationale}
                                                  onCheckedChange={(checked) => handleLLMOptions(checked, "includeRationale")}
                                                  disabled={!llmOptions.includeExamples}/>
                                        <label htmlFor="llm-rationale"
                                               className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                            Include rationale
                                        </label>
                                    </div>
                                    <IconButton onClick={handleCloseDialog}>
                                        <CloseIcon/>
                                    </IconButton>
                                </div>
                            </div>

                            <div className="height-[30vh]">
                                <div className="d-flex flex-row gap-2 mt-3 align-items-center">
                                    <div className="w-5">#</div>
                                    <div className="w-50">Question</div>
                                    <div className="w-40">Answer <span
                                        className="text-slate-600/60 text-xs">(Comma-separated)</span></div>
                                    <div className='flex flex-row gap-2'>
                                        <Tooltip title={tooltipText.search.llmQuestion.add} placement="top">
                                            <IconButton onClick={handleAddLLMQuestion}>
                                                <AddIcon/>
                                            </IconButton>
                                        </Tooltip>
                                    </div>
                                </div>
                                {
                                    llmQuestions && llmQuestions.length > 0 && llmQuestions.map((question, index) => (
                                        <div key={question.id} className="d-flex flex-row gap-2 mt-3">
                                            <div
                                                className="d-flex align-items-center justify-content-center w-5">{index + 1}</div>
                                            <Input
                                                name="question"
                                                className="bg-white"
                                                placeholder="Question"
                                                value={question.question}
                                                onChange={(e) => handleLLMQuestionChange(e, question)}
                                            />
                                            <Input
                                                name="answer"
                                                className="bg-white"
                                                placeholder="Answer"
                                                value={question.answer}
                                                onChange={(e) => handleLLMQuestionChange(e, question)}
                                            />
                                            <Tooltip title={tooltipText.search.llmQuestion.remove} placement="top">
                                                <Button
                                                    className="bg-red-600 hover:bg-red-700/80"
                                                    onClick={() => handleRemoveLLMQuestion(question)}
                                                >
                                                    <DeleteIcon/>
                                                </Button>
                                            </Tooltip>
                                        </div>
                                    ))
                                }
                            </div>

                            {llmOptions.includeExamples && (
                                <div className="llm-example-section mt-3">
                                    <div className="d-flex justify-content-between align-items-start gap-2 flex-wrap">
                                        <div>
                                            <div className="font-medium">Example papers</div>
                                            <div className="text-sm text-slate-600">
                                                Choose any selected papers to use as labeled examples for the LLM review.
                                            </div>
                                            {llmExamplePaperIds.length > 0 && (
                                                <div className="text-xs text-slate-500">
                                                    After choosing papers, select an answer for each example row below.
                                                </div>
                                            )}
                                        </div>
                                        <div className="text-sm text-slate-600">
                                            {llmExamplePaperIds.length} chosen
                                        </div>
                                    </div>

                                    {selectedPaperRecords.length === 0 ? (
                                        <div className="llm-example-empty">
                                            Select papers from the results table before configuring LLM examples.
                                        </div>
                                    ) : (
                                        <div className="llm-example-picker" aria-label="Choose LLM example papers">
                                            {selectedPaperRecords.map((paper, index) => (
                                                <label key={paper.paper_id} className="llm-example-option">
                                                    <Checkbox
                                                        checked={llmExamplePaperIds.includes(paper.paper_id)}
                                                        onCheckedChange={(checked) => handleToggleLLMExamplePaper(paper.paper_id, checked)}
                                                    />
                                                    <span className="llm-example-index">{index + 1}</span>
                                                    <span className="llm-example-title">{paper.paper_title}</span>
                                                </label>
                                            ))}
                                        </div>
                                    )}

                                    {llmExamplePapers.length > 0 && (
                                        <div className="flex flex-row mt-3 min-w-full">
                                            <div className="table-responsive">
                                                <table className="table table-striped">
                                                    <thead className="bg-primary text-white">
                                                        <tr>
                                                            <td>Paper ID</td>
                                                            <td style={{minWidth: "300px"}}>Paper Title</td>
                                                            <td style={{minWidth: "300px"}}>Search String</td>
                                                            <td style={{minWidth: "300px"}}>Formatted Search String</td>
                                                            <td>Abstract</td>
                                                            <td style={{minWidth: "300px"}}>Authors</td>
                                                            <td style={{minWidth: "300px"}}>Citations Count</td>
                                                            <td style={{minWidth: "300px"}}>Conference/Journal</td>
                                                            <td style={{minWidth: "300px"}}>DOI</td>
                                                            <td>Publication Date</td>
                                                            <td>Publication Type</td>
                                                            <td>Publisher</td>
                                                            {
                                                                llmQuestions.map((question) => (
                                                                    <td key={question.id} style={{minWidth: "300px"}}>
                                                                        Q{question.id}: Answer & Rationale
                                                                    </td>
                                                                ))
                                                            }
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                    {llmExamplePapers.map((paper) => (
                                                        <tr key={paper.paper_id}>
                                                            <td>
                                                                <a
                                                                    href={paper.paper_id.slice(4)}
                                                                    target="_blank"
                                                                    rel="noopener noreferrer"
                                                                    className="text-blue-500 underline"
                                                                >
                                                                    {paper.paper_id.slice(4)}
                                                                </a>
                                                            </td>
                                                            <td>{paper.paper_title}</td>
                                                            <td>{paper.search_string}</td>
                                                            <td>{paper.formatted_search_string}</td>
                                                            <td>
                                                                <div style={{maxHeight: "120px", overflow: "auto", width: '550px'}}>
                                                                    {paper.abstract}
                                                                </div>
                                                            </td>
                                                            <td>
                                                                <div style={{maxHeight: "120px", overflow: "auto"}}>
                                                                    {parseAuthors(paper.authors)}
                                                                </div>
                                                            </td>
                                                            <td>{paper.citation_count}</td>
                                                            <td>{paper.conference_journal}</td>
                                                            <td>{paper.doi}</td>
                                                            <td>{paper.publication_date}</td>
                                                            <td>{paper.publication_type}</td>
                                                            <td>{paper.publisher}</td>
                                                            {llmQuestions.map((llmQuestion, questionIdx) => {
                                                                const paperAnswer = llmAnswers.find((answer) => answer.paper_id === paper.paper_id);

                                                                return (
                                                                    <td key={llmQuestion.id}>
                                                                        <Select
                                                                            value={paperAnswer?.responses[questionIdx]?.answer || ""}
                                                                            onValueChange={(value) => updateLLMAnswer(paper.paper_id, questionIdx, "answer", value)}
                                                                        >
                                                                            <SelectTrigger className="bg-white">
                                                                                <SelectValue placeholder="Select Answer"/>
                                                                            </SelectTrigger>
                                                                            <SelectContent>
                                                                                {getLLMQuestionAnswerOptions(llmQuestion.answer).map((choice) => (
                                                                                    <SelectItem key={choice} value={choice}>
                                                                                        {choice}
                                                                                    </SelectItem>
                                                                                ))}
                                                                            </SelectContent>
                                                                        </Select>
                                                                        {
                                                                            llmOptions.includeRationale &&
                                                                            <Input
                                                                                placeholder="Rationale"
                                                                                className="bg-white"
                                                                                value={paperAnswer?.responses[questionIdx]?.rationale || ""}
                                                                                onChange={(e) => updateLLMAnswer(paper.paper_id, questionIdx, "rationale", e.target.value)}
                                                                            />
                                                                        }
                                                                    </td>
                                                                )
                                                            })}
                                                        </tr>
                                                    ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            <div className="d-flex justify-content-end align-items-center gap-3 mt-3">
                                {isLLMFilterProcessing && (
                                    <div className="llm-progress-text" aria-live="polite">
                                        {getLLMProgressText()}
                                    </div>
                                )}
                                <Button
                                    className="bg-green-600 hover:bg-green-700/80"
                                    disabled={isLLMFilterProcessing}
                                    onClick={handleLLMFiltering}
                                >
                                    {isLLMFilterProcessing ? <Spinner/> : "Submit Questions"}
                                </Button>
                            </div>
                        </div>
                    </DialogContent>
                }

                {
                    showDialogPrompt !== PublicationOperation.LLM_FILTER &&
                    <DialogContent className="sm:max-w-[425px]">
                        <DialogHeader>
                            <DialogTitle>{getDialogTitle()}</DialogTitle>
                        </DialogHeader>
                        <DialogDescription>
                            <span>Are you sure about performing the following operation:</span>
                            <br/>
                            <span>{getDialogDescription(selectedPapers.length)}</span>
                        </DialogDescription>
                        <DialogFooter>
                            <Button
                                className=""
                                disabled={isPerformingOperation || snowballingType !== ''}
                                onClick={handleOperation(showDialogPrompt as PublicationOperation)}
                            >
                                {isPerformingOperation ? <Spinner/> : 'Confirm'}
                            </Button>
                            <Button
                                className="bg-slate-500 hover:bg-slate-600 active:border-none shadow-none"
                                onClick={handleCloseDialog}
                            >
                                Cancel
                            </Button>
                        </DialogFooter>
                    </DialogContent>
                }


            </Dialog>
        </>
    );
}

export default PaperOperations;
