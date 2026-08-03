# ARC: Automated Review Companion

**A human-centered, open-source system for conducting rigorous Systematic Literature Reviews (SLRs).**

ARC is an integrated research tool designed to support the fluid, iterative nature of the Systematic Literature Review process. Unlike fragmented "point solutions" that handle only specific tasks, Arc unifies multi-database searching, iterative query refinement, automated snowballing, and verifiable AI-assisted screening into a single, cohesive workflow.

This system was designed to address key friction points in modern research: high cognitive load during search exploration, the overwhelming scale of new literature, and the need to balance automation with scholarly agency.

## Key Features

*   **Integrated Multi-Database Search:** Execute flexible keyword searches simultaneously across major scholarly databases (Semantic Scholar, DBLP, Web of Science, IEEE Xplore, and Scopus).
*   **Iterative Search Comparison:** Visualizes the "diff" between search iterations, allowing researchers to see exactly which papers were added or removed when query parameters (keywords, dates) change.
*   **Automated Snowballing:** Performs one-click forward (citations) and backward (references) reference searching to identify connected works without manual data entry.
*   **Verifiable AI-Assisted Screening:** A human-in-the-loop module that uses Large Language Models (LLMs) to filter papers based on user-defined inclusion/exclusion criteria. Crucially, the AI provides **rationales** for every suggestion, ensuring the researcher remains in control of the final decision.
*   **Metadata Curation:** Automatically deduplicates records and standardizes metadata (DOIs, abstracts) for export to standard formats (BibTeX, CSV, RIS).

## Reference Paper

If you use ARC in your research or find the codebase useful, please cite our paper:

> **From Toil to Thought: Designing for Strategic Exploration and Responsible AI in Systematic Literature Reviews**. *Proceedings of the 31st International Conference on Intelligent User Interfaces (IUI '26)*.

### BibTeX

```bibtex
@inproceedings{ye2026toil,
  author = {Ye, Runlong and Sibia, Naaz and Zavaleta Bernuy, Angela and Zhu, Tingting and Nobre, Carolina and Pammer-Schindler, Viktoria and Liut, Michael},
  title = {From Toil to Thought: Designing for Strategic Exploration and Responsible AI in Systematic Literature Reviews},
  booktitle = {Proceedings of the 31st International Conference on Intelligent User Interfaces (IUI '26)},
  year = {2026},
  publisher = {ACM},
  address = {Paphos, Cyprus},
  url = {https://doi.org/10.1145/3742413.3789079},
  doi = {10.1145/3742413.3789079},
  isbn = {979-8-4007-1984-4/26/03},
  pages = {22 pages}
}
```

***
## Setup Instructions

### Backend Setup
1. Create and activate virtual environment:
```bash
cd publication-scraper-backend
python -m venv .venv
source .venv/bin/activate  # On Windows use: .venv\Scripts\activate
```

2. Install dependencies:
```bash
pip install -r requirements.txt
```

3. Setup environment variables:
```bash
cp .env.example .env  # Create your .env file from template and fill in required values
```

Required environment variables in .env:
```plaintext
AZURE_RESOURCE_NAME=your_azure_resource_name    # Azure OpenAI resource name
AZURE_API_KEY=your_azure_api_key               # Azure OpenAI API key
AZURE_DEPLOYMENT_NAME=your_deployment_name      # Azure OpenAI deployment name
SEMANTIC_SCHOLAR_KEY=your_key                  # API key for Semantic Scholar
WOS_KEY=your_key                              # Web of Science API key
SCOPUS_KEY=your_key                           # Scopus API key
IEEE_API_KEY=your_key                         # IEEE Xplore API key
OPENAI_API_KEY=your_key                       # OpenAI API key (or local LLM-compatible key)
OPENAI_BASE_URL=https://api.openai.com/v1     # Optional: OpenAI-compatible base URL
OPENAI_MODEL=gpt-5.5                          # Optional: model name for the LLM filter
MAX_LLM_CALL_COUNT=300                        # Optional: daily per-IP cap on papers sent to the LLM filter

```

4. Run migrations:
```bash
python manage.py migrate
```

5. Start the development server:
```bash
python manage.py runserver
```
The backend will be available at http://localhost:8000

### Frontend Setup
1. Navigate to frontend directory:
```bash
cd publication-scraper-web
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```
The frontend will be available at http://localhost:3000
