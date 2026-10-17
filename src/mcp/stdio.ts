import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

await createMcpServer("stdio").connect(new StdioServerTransport());
