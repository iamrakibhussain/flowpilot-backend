-- CreateEnum
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionStatus') THEN
    CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'EXPIRED', 'INCOMPLETE');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionBillingInterval') THEN
    CREATE TYPE "SubscriptionBillingInterval" AS ENUM ('MONTHLY', 'ANNUALLY');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'SubscriptionTier') THEN
    CREATE TYPE "SubscriptionTier" AS ENUM ('FREE', 'STARTER', 'PRO', 'ENTERPRISE');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "subscription_plans" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tier" "SubscriptionTier" NOT NULL DEFAULT 'STARTER',
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL DEFAULT 0.0,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "interval" "SubscriptionBillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "stripe_price_id" TEXT,
    "stripe_product_id" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "max_members" INTEGER NOT NULL DEFAULT 5,
    "max_customers" INTEGER NOT NULL DEFAULT 100,
    "max_projects" INTEGER NOT NULL DEFAULT 10,
    "max_services" INTEGER NOT NULL DEFAULT 20,
    "has_flow_rules" BOOLEAN NOT NULL DEFAULT false,
    "has_custom_domain" BOOLEAN NOT NULL DEFAULT false,
    "has_analytics" BOOLEAN NOT NULL DEFAULT true,
    "has_recurring" BOOLEAN NOT NULL DEFAULT false,
    "has_client_portal" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "organization_subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan_id" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "billing_interval" "SubscriptionBillingInterval" NOT NULL DEFAULT 'MONTHLY',
    "current_period_start" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "trial_ends_at" TIMESTAMP(3),
    "canceled_at" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "stripe_customer_id" TEXT,
    "stripe_subscription_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "subscription_billing_records" (
    "id" TEXT NOT NULL,
    "subscription_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "stripe_invoice_id" TEXT,
    "stripe_payment_intent_id" TEXT,
    "invoice_pdf_url" TEXT,
    "paid_at" TIMESTAMP(3),
    "billing_period_start" TIMESTAMP(3),
    "billing_period_end" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_billing_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "subscription_webhook_events" (
    "id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PROCESSED',
    "payload" JSONB,
    "error_message" TEXT,
    "processed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_slug_key" ON "subscription_plans"("slug");
CREATE UNIQUE INDEX IF NOT EXISTS "subscription_plans_stripe_price_id_key" ON "subscription_plans"("stripe_price_id");

CREATE UNIQUE INDEX IF NOT EXISTS "organization_subscriptions_organization_id_key" ON "organization_subscriptions"("organization_id");
CREATE UNIQUE INDEX IF NOT EXISTS "organization_subscriptions_stripe_subscription_id_key" ON "organization_subscriptions"("stripe_subscription_id");
CREATE INDEX IF NOT EXISTS "organization_subscriptions_organization_id_idx" ON "organization_subscriptions"("organization_id");
CREATE INDEX IF NOT EXISTS "organization_subscriptions_status_idx" ON "organization_subscriptions"("status");
CREATE INDEX IF NOT EXISTS "organization_subscriptions_stripe_customer_id_idx" ON "organization_subscriptions"("stripe_customer_id");

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_billing_records_stripe_invoice_id_key" ON "subscription_billing_records"("stripe_invoice_id");
CREATE INDEX IF NOT EXISTS "subscription_billing_records_organization_id_idx" ON "subscription_billing_records"("organization_id");
CREATE INDEX IF NOT EXISTS "subscription_billing_records_subscription_id_idx" ON "subscription_billing_records"("subscription_id");

CREATE UNIQUE INDEX IF NOT EXISTS "subscription_webhook_events_event_id_key" ON "subscription_webhook_events"("event_id");
CREATE INDEX IF NOT EXISTS "subscription_webhook_events_event_id_idx" ON "subscription_webhook_events"("event_id");
CREATE INDEX IF NOT EXISTS "subscription_webhook_events_event_type_idx" ON "subscription_webhook_events"("event_type");

-- AddForeignKeys
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'organization_subscriptions_organization_id_fkey'
  ) THEN
    ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'organization_subscriptions_plan_id_fkey'
  ) THEN
    ALTER TABLE "organization_subscriptions" ADD CONSTRAINT "organization_subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "subscription_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'subscription_billing_records_subscription_id_fkey'
  ) THEN
    ALTER TABLE "subscription_billing_records" ADD CONSTRAINT "subscription_billing_records_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "organization_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- SeedApprovedSubscriptionPlans
INSERT INTO "subscription_plans" (
    "id",
    "slug",
    "name",
    "tier",
    "description",
    "price",
    "currency",
    "interval",
    "max_members",
    "max_customers",
    "max_projects",
    "max_services",
    "has_flow_rules",
    "has_custom_domain",
    "has_analytics",
    "has_recurring",
    "has_client_portal",
    "created_at",
    "updated_at"
) VALUES
('plan_starter_monthly', 'starter-monthly', 'Starter', 'STARTER', 'Essential business operations foundation for solo practitioners and micro-studios.', 0.00, 'USD', 'MONTHLY', 3, 50, 5, 10, true, false, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('plan_starter_annually', 'starter-annually', 'Starter', 'STARTER', 'Essential business operations foundation for solo practitioners and micro-studios.', 0.00, 'USD', 'ANNUALLY', 3, 50, 5, 10, true, false, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('plan_pro_monthly', 'pro-monthly', 'Professional', 'PRO', 'Advanced automations, custom domains, and scalable capacity for growing agencies.', 49.00, 'USD', 'MONTHLY', 10, 500, 25, 50, true, true, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('plan_pro_annually', 'pro-annually', 'Professional', 'PRO', 'Advanced automations, custom domains, and scalable capacity for growing agencies (20% discount).', 468.00, 'USD', 'ANNUALLY', 10, 500, 25, 50, true, true, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('plan_enterprise_monthly', 'enterprise-monthly', 'Enterprise', 'ENTERPRISE', 'Unlimited capacity, highest priority support, and multi-team operational infrastructure.', 149.00, 'USD', 'MONTHLY', 999, 50000, 1000, 500, true, true, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
('plan_enterprise_annually', 'enterprise-annually', 'Enterprise', 'ENTERPRISE', 'Unlimited capacity, highest priority support, and multi-team operational infrastructure (20% discount).', 1428.00, 'USD', 'ANNUALLY', 999, 50000, 1000, 500, true, true, true, true, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("id") DO UPDATE SET
    "price" = EXCLUDED."price",
    "max_members" = EXCLUDED."max_members",
    "max_customers" = EXCLUDED."max_customers",
    "max_projects" = EXCLUDED."max_projects",
    "max_services" = EXCLUDED."max_services",
    "has_flow_rules" = EXCLUDED."has_flow_rules",
    "has_custom_domain" = EXCLUDED."has_custom_domain",
    "has_analytics" = EXCLUDED."has_analytics",
    "has_recurring" = EXCLUDED."has_recurring",
    "has_client_portal" = EXCLUDED."has_client_portal",
    "updated_at" = CURRENT_TIMESTAMP;


