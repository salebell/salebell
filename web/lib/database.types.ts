// Supabase database types matching the repository's application schema.
// The Database type is verbatim; the generic Tables/Enums helpers are omitted. Aliases at the bottom are ours.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      account_members: {
        Row: {
          account_id: string
          created_at: string
          role: string
          user_id: string
        }
        Insert: {
          account_id: string
          created_at?: string
          role?: string
          user_id: string
        }
        Update: {
          account_id?: string
          created_at?: string
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "account_members_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      accounts: {
        Row: {
          created_at: string
          current_period_end: string | null
          id: string
          name: string
          plan: string
          stripe_customer_id: string | null
          stripe_subscription_id: string | null
          subscription_status: string | null
        }
        Insert: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          name: string
          plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
        }
        Update: {
          created_at?: string
          current_period_end?: string | null
          id?: string
          name?: string
          plan?: string
          stripe_customer_id?: string | null
          stripe_subscription_id?: string | null
          subscription_status?: string | null
        }
        Relationships: []
      }
      alert_channels: {
        Row: {
          app_id: string
          config: Json
          created_at: string
          enabled: boolean
          environments: string[]
          events: string[] | null
          id: string
          kind: string
          name: string | null
        }
        Insert: {
          app_id: string
          config?: Json
          created_at?: string
          enabled?: boolean
          environments?: string[]
          events?: string[] | null
          id?: string
          kind: string
          name?: string | null
        }
        Update: {
          app_id?: string
          config?: Json
          created_at?: string
          enabled?: boolean
          environments?: string[]
          events?: string[] | null
          id?: string
          kind?: string
          name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_channels_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      alert_deliveries: {
        Row: {
          app_id: string
          attempts: number
          channel_id: string | null
          created_at: string
          error: string | null
          event_id: string
          id: number
          ok: boolean
          status: number | null
        }
        Insert: {
          app_id: string
          attempts?: number
          channel_id?: string | null
          created_at?: string
          error?: string | null
          event_id: string
          id?: never
          ok: boolean
          status?: number | null
        }
        Update: {
          app_id?: string
          attempts?: number
          channel_id?: string | null
          created_at?: string
          error?: string | null
          event_id?: string
          id?: never
          ok?: boolean
          status?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "alert_deliveries_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "alert_deliveries_channel_id_fkey"
            columns: ["channel_id"]
            isOneToOne: false
            referencedRelation: "alert_channels"
            referencedColumns: ["id"]
          },
        ]
      }
      apps: {
        Row: {
          account_id: string
          apple_app_id: number | null
          bundle_id: string
          created_at: string
          enabled: boolean
          forward_url_production: string | null
          forward_url_sandbox: string | null
          id: string
          last_event_production_at: string | null
          last_event_sandbox_at: string | null
          name: string
          package_name: string | null
          store: string
          webhook_key: string
        }
        Insert: {
          account_id: string
          apple_app_id?: number | null
          bundle_id: string
          created_at?: string
          enabled?: boolean
          forward_url_production?: string | null
          forward_url_sandbox?: string | null
          id?: string
          last_event_production_at?: string | null
          last_event_sandbox_at?: string | null
          name: string
          package_name?: string | null
          store?: string
          webhook_key?: string
        }
        Update: {
          account_id?: string
          apple_app_id?: number | null
          bundle_id?: string
          created_at?: string
          enabled?: boolean
          forward_url_production?: string | null
          forward_url_sandbox?: string | null
          id?: string
          last_event_production_at?: string | null
          last_event_sandbox_at?: string | null
          name?: string
          package_name?: string | null
          store?: string
          webhook_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "apps_account_id_fkey"
            columns: ["account_id"]
            isOneToOne: false
            referencedRelation: "accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      fx_rates: {
        Row: {
          currency: string
          updated_at: string
          usd_per_unit: number
        }
        Insert: {
          currency: string
          updated_at?: string
          usd_per_unit: number
        }
        Update: {
          currency?: string
          updated_at?: string
          usd_per_unit?: number
        }
        Relationships: []
      }
      push_devices: {
        Row: {
          apns_environment: string
          app_version: string | null
          created_at: string
          enabled: boolean
          id: string
          last_seen_at: string
          sandbox_alerts: boolean
          token: string
          user_id: string
        }
        Insert: {
          apns_environment: string
          app_version?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          last_seen_at?: string
          sandbox_alerts?: boolean
          token: string
          user_id: string
        }
        Update: {
          apns_environment?: string
          app_version?: string | null
          created_at?: string
          enabled?: boolean
          id?: string
          last_seen_at?: string
          sandbox_alerts?: boolean
          token?: string
          user_id?: string
        }
        Relationships: []
      }
      store_events: {
        Row: {
          app_id: string
          app_user_id: string | null
          currency: string | null
          environment: string
          id: string
          is_family_shared: boolean
          is_trial: boolean
          occurred_at: string
          original_transaction_id: string | null
          payload: Json
          product_id: string | null
          raw_subtype: string | null
          raw_type: string
          received_at: string
          revenue: number | null
          store: string
          storefront: string | null
          transaction_id: string | null
          type: string
        }
        Insert: {
          app_id: string
          app_user_id?: string | null
          currency?: string | null
          environment: string
          id: string
          is_family_shared?: boolean
          is_trial?: boolean
          occurred_at: string
          original_transaction_id?: string | null
          payload: Json
          product_id?: string | null
          raw_subtype?: string | null
          raw_type: string
          received_at?: string
          revenue?: number | null
          store: string
          storefront?: string | null
          transaction_id?: string | null
          type: string
        }
        Update: {
          app_id?: string
          app_user_id?: string | null
          currency?: string | null
          environment?: string
          id?: string
          is_family_shared?: boolean
          is_trial?: boolean
          occurred_at?: string
          original_transaction_id?: string | null
          payload?: Json
          product_id?: string | null
          raw_subtype?: string | null
          raw_type?: string
          received_at?: string
          revenue?: number | null
          store?: string
          storefront?: string | null
          transaction_id?: string | null
          type?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
      store_transactions: {
        Row: {
          app_id: string
          app_user_id: string | null
          currency: string | null
          environment: string
          expires_at: string | null
          first_seen_at: string
          offer_discount_type: string | null
          original_transaction_id: string
          ownership_type: string | null
          payload: Json
          price_milliunits: number | null
          product_id: string
          purchased_at: string
          revoked_at: string | null
          signed_at: string
          store: string
          storefront: string | null
          transaction_id: string
          transaction_reason: string | null
          updated_at: string
        }
        Insert: {
          app_id: string
          app_user_id?: string | null
          currency?: string | null
          environment: string
          expires_at?: string | null
          first_seen_at?: string
          offer_discount_type?: string | null
          original_transaction_id: string
          ownership_type?: string | null
          payload: Json
          price_milliunits?: number | null
          product_id: string
          purchased_at: string
          revoked_at?: string | null
          signed_at: string
          store?: string
          storefront?: string | null
          transaction_id: string
          transaction_reason?: string | null
          updated_at?: string
        }
        Update: {
          app_id?: string
          app_user_id?: string | null
          currency?: string | null
          environment?: string
          expires_at?: string | null
          first_seen_at?: string
          offer_discount_type?: string | null
          original_transaction_id?: string
          ownership_type?: string | null
          payload?: Json
          price_milliunits?: number | null
          product_id?: string
          purchased_at?: string
          revoked_at?: string | null
          signed_at?: string
          store?: string
          storefront?: string | null
          transaction_id?: string
          transaction_reason?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "store_transactions_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      daily_revenue: {
        Row: {
          app_id: string | null
          cancellations: number | null
          currency: string | null
          day: string | null
          environment: string | null
          gross_revenue: number | null
          gross_revenue_usd: number | null
          purchases: number | null
          refunds: number | null
          renewals: number | null
          trials: number | null
        }
        Relationships: [
          {
            foreignKeyName: "store_events_app_id_fkey"
            columns: ["app_id"]
            isOneToOne: false
            referencedRelation: "apps"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Functions: {
      app_overview: {
        Args: { p_tz?: string }
        Returns: {
          account_id: string
          app_id: string
          apple_app_id: number
          bundle_id: string
          enabled: boolean
          gross_usd_30d: number
          gross_usd_7d: number
          gross_usd_today: number
          last_event_production_at: string
          last_event_sandbox_at: string
          name: string
          paused: boolean
          purchases_30d: number
          purchases_7d: number
          purchases_today: number
          refunds_30d: number
          refunds_7d: number
          refunds_today: number
          renewals_30d: number
          renewals_7d: number
          renewals_today: number
          trials_30d: number
          trials_7d: number
          trials_today: number
        }[]
      }
      apply_stripe_subscription: {
        Args: {
          p_account: string
          p_customer: string
          p_period_end: string
          p_status: string
          p_subscription: string
        }
        Returns: string
      }
      billing_owner_account: {
        Args: { p_account?: string; p_user: string }
        Returns: {
          id: string
          name: string
          plan: string
          stripe_customer_id: string
          stripe_subscription_id: string
          subscription_status: string
        }[]
      }
      create_account: { Args: { p_name: string }; Returns: string }
      delete_sole_owned_accounts: { Args: { p_user: string }; Returns: number }
      disable_push_devices: { Args: { p_tokens: string[] }; Returns: number }
      delete_user_google_play_connection: {
        Args: { p_app_id: string; p_user: string }
        Returns: boolean
      }
      google_connection_status: {
        Args: { p_app_id: string; p_user: string }
        Returns: Json
      }
      google_webhook_app: {
        Args: { p_key: string }
        Returns: {
          audience: string
          connection_version: string
          enabled: boolean
          id: string
          name: string
          package_name: string
          service_account_email: string
          subscription: string
        }[]
      }
      is_account_member: {
        Args: { p_account: string; p_roles?: string[] }
        Returns: boolean
      }
      instance_settings: { Args: Record<PropertyKey, never>; Returns: Json }
      load_google_play_credentials: {
        Args: { p_app_id: string }
        Returns: Json
      }
      log_alert_deliveries: {
        Args: { p_app_id: string; p_deliveries: Json; p_event_id: string }
        Returns: undefined
      }
      record_google_play_event: {
        Args: {
          p_app_id: string
          p_connection_version?: string
          p_event: Json
          p_payload: Json
        }
        Returns: Json
      }
      record_store_event: {
        Args: {
          p_app_id: string
          p_event: Json
          p_payload: Json
          p_transaction: Json
        }
        Returns: Json
      }
      register_push_device: {
        Args: {
          p_apns_environment: string
          p_app_version?: string
          p_token: string
        }
        Returns: string
      }
      save_google_play_connection: {
        Args: {
          p_app_id: string
          p_audience: string
          p_credentials: Json
          p_service_account_email: string
          p_subscription: string
        }
        Returns: undefined
      }
      save_user_google_play_connection: {
        Args: {
          p_app_id: string
          p_user: string
          p_package_name: string
          p_webhook_key: string
          p_audience: string
          p_service_account_email: string
          p_subscription: string
          p_credentials: Json
          p_topic: string
        }
        Returns: undefined
      }
      sole_owned_accounts: {
        Args: { p_user: string }
        Returns: {
          id: string
          stripe_subscription_id: string
          subscription_status: string
        }[]
      }
      test_alert_targets: {
        Args: { p_app_id: string; p_user: string }
        Returns: Json
      }
      upsert_fx_rates: { Args: { p_rates: Json }; Returns: number }
      webhook_app: {
        Args: { p_key: string }
        Returns: {
          apple_app_id: number
          bundle_id: string
          enabled: boolean
          forward_url_production: string
          forward_url_sandbox: string
          id: string
          name: string
        }[]
      }
    }
    Enums: {
      [_ in never]: never
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

// ---------- app aliases ----------

export type ChannelKind = "slack" | "discord" | "telegram" | "webhook" | "posthog" | "pushover" | "ntfy";

type Tables = Database["public"]["Tables"];
export type Account = Tables["accounts"]["Row"];
export type AppRow = Tables["apps"]["Row"];
export type Channel = Tables["alert_channels"]["Row"];
export type StoreEvent = Tables["store_events"]["Row"];
export type DailyRevenue = Database["public"]["Views"]["daily_revenue"]["Row"];
