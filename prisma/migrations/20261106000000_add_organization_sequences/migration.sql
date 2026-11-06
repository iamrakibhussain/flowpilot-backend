-- CreateTable
CREATE TABLE IF NOT EXISTS "organization_sequences" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "last_sequence" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_sequences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "organization_sequences_organization_id_entity_type_year_key" ON "organization_sequences"("organization_id", "entity_type", "year");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "organization_sequences_organization_id_idx" ON "organization_sequences"("organization_id");

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'organization_sequences_organization_id_fkey'
  ) THEN
    ALTER TABLE "organization_sequences" ADD CONSTRAINT "organization_sequences_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

