import { handleError } from "@/common/handler";
import { tooltipText } from "@/data/tooltip";
import { cn } from "@/lib/utils";
import { ButtonState } from "@/types";
import { BASE_URL } from "@/utils/common";
import { Tooltip } from "@mui/material";
import axios, { AxiosError } from "axios";
import { toast } from "react-toastify";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "./ui/dropdown-menu";

export interface ExportDropdownProps {
  selectedPapers: string[];
  buttonState: ButtonState;
  diffMode: boolean;
  currentSearchReferenceId?: string;
}

const ExportDropdown: React.FC<ExportDropdownProps> = (props) => {

  const { selectedPapers, diffMode, currentSearchReferenceId } = props;
  const isExportDisabled = selectedPapers.length === 0 || diffMode;
  const exportFormats = [
    {
      label: "CSV",
      format: "CSV",
    },
    {
      label: "BibTex",
      format: "BIBTEX",
    },
    {
      label: "RIS",
      format: "RIS",
    }
  ];

  const parseFilename = (contentDisposition: string | undefined, format: string): string => {
    const fallback = `papers.${format.toLowerCase()}`;
    if (!contentDisposition) return fallback;
    const match = /filename\*?=(?:UTF-8'')?["']?([^"';]+)["']?/i.exec(contentDisposition);
    return match?.[1]?.trim() || fallback;
  }

  const handleExport = async (format: string) => {
    let link: HTMLAnchorElement | null = null;
    let url: string | null = null;
    try {
      const res = await axios.post(`${BASE_URL}/scraper/export`, {
        paper_ids: selectedPapers,
        format,
        search_reference_id: currentSearchReferenceId
      });
      url = window.URL.createObjectURL(new Blob([res.data]));
      link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', parseFilename(res.headers['content-disposition'], format));
      document.body.appendChild(link);
      link.click();
      toast.success("Exported papers successfully");
    } catch (error) {
      handleError(error as AxiosError);
    } finally {
      if (link && link.parentNode) link.parentNode.removeChild(link);
      if (url) window.URL.revokeObjectURL(url);
    }
  }

  const dropdownClasses = cn(
    "inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium",
    "h-9 px-4 shadow-sm",
    "bg-blue-600 text-white hover:bg-blue-700 active:bg-blue-800",
    "transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-300",
    "disabled:pointer-events-none disabled:border disabled:border-slate-300 disabled:bg-slate-200 disabled:text-slate-500 disabled:shadow-none",
    "dropdown-toggle hover:cursor-pointer",
  );

  const exportTrigger = (
    <span title={isExportDisabled ? tooltipText.results.export.disabled : undefined}>
      <DropdownMenuTrigger
        disabled={isExportDisabled}
        className={dropdownClasses}
        aria-label="Export Papers"
      >
        Export
      </DropdownMenuTrigger>
    </span>
  );
  
  return ( 
    <DropdownMenu>
      {isExportDisabled ? (
        exportTrigger
      ) : (
        <Tooltip title={tooltipText.results.export.enabled} placement="bottom">
          {exportTrigger}
        </Tooltip>
      )}
      <DropdownMenuContent>

        {exportFormats.map((exportFormat) => (
          <DropdownMenuItem 
            key={exportFormat.format} 
            onClick={() => handleExport(exportFormat.format)}
          >
            {exportFormat.label}
          </DropdownMenuItem>
        ))}

      </DropdownMenuContent>
    </DropdownMenu>
   );
}
 
export default ExportDropdown;
