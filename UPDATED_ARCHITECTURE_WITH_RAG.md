llm-service/
├── src/
│ ├── main.ts # Boots API or Worker based on env
│ ├── app.module.ts # Imports all modules
│ │
│ ├── llm/
│ │ ├── llm.module.ts
│ │ ├── rag.service.ts # Existing (for querying)
│ │ └── llm.controller.ts # Existing chat endpoints
│ │
│ ├── ingestion/ # NEW: PDF ingestion
│ │ ├── ingestion.module.ts
│ │ ├── ingestion.controller.ts # API endpoint (API pods only)
│ │ ├── ingestion.processor.ts # Worker (Worker pods only)
│ │ ├── ingestion.service.ts # Shared logic
│ │ └── dto/
│ │ └── ingest-pdf.dto.ts
│ │
│ ├── queue/ # NEW: BullMQ config
│ │ ├── queue.module.ts
│ │ └── queue.config.ts
│ │
│ └── config/
│ └── environment.ts
│
└── package.json
