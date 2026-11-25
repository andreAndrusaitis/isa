import { Router } from 'express'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { authenticateMcp } from '../middlewares/mcpAuth'
import { buildMcpServer } from '../mcp/server'
import { authenticateMcpChamados } from '../middlewares/entraAuth'
import { buildChamadosMcpServer } from '../mcp/chamados'

const router = Router()

router.post('/', authenticateMcp, async (req, res, next) => {
  try {
    const server = buildMcpServer(req.mcpUserId!)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    next(error)
  }
})

// Chamados do próprio solicitante (Copilot / M365): token Entra ID ou isamcp_.
router.post('/chamados', authenticateMcpChamados, async (req, res, next) => {
  try {
    const server = buildChamadosMcpServer(req.mcpUserId!, req.mcpVia)
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
    res.on('close', () => {
      transport.close()
      server.close()
    })
    await server.connect(transport)
    await transport.handleRequest(req, res, req.body)
  } catch (error) {
    next(error)
  }
})

export default router
