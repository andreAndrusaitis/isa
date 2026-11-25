-- CreateIndex
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'mcp_tokens_token_hash_key'
    ) THEN
        ALTER TABLE "mcp_tokens" ADD CONSTRAINT "mcp_tokens_token_hash_key" UNIQUE ("token_hash");
    END IF;
END $$;
