// ponytail: hand-written to mirror Supabase codegen shape. `supabase gen types`
// needs a container runtime (Docker/podman) which isn't available here, and the
// Supabase MCP has no access to this project. Regenerate with `npm run gen:types`
// (needs Docker) or the MCP once either is available — keep this in sync with
// supabase/migrations until then.
export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  public: {
    Tables: {
      tenants: {
        Row: { id: string; name: string; created_at: string }
        Insert: { id?: string; name: string; created_at?: string }
        Update: { id?: string; name?: string; created_at?: string }
        Relationships: []
      }
      profiles: {
        Row: {
          id: string
          tenant_id: string
          role: string
          full_name: string | null
          created_at: string
        }
        Insert: {
          id: string
          tenant_id: string
          role?: string
          full_name?: string | null
          created_at?: string
        }
        Update: {
          id?: string
          tenant_id?: string
          role?: string
          full_name?: string | null
          created_at?: string
        }
        Relationships: [
          {
            foreignKeyName: 'profiles_tenant_id_fkey'
            columns: ['tenant_id']
            isOneToOne: false
            referencedRelation: 'tenants'
            referencedColumns: ['id']
          },
        ]
      }
      styles: {
        Row: { id: string; tenant_id: string; code: string; name: string; collection: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; code: string; name: string; collection?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; name?: string; collection?: string | null; created_at?: string }
        Relationships: []
      }
      colorways: {
        Row: { id: string; tenant_id: string; style_id: string; color_name: string; color_code: string; created_at: string }
        Insert: { id?: string; tenant_id: string; style_id: string; color_name: string; color_code: string; created_at?: string }
        Update: { id?: string; tenant_id?: string; style_id?: string; color_name?: string; color_code?: string; created_at?: string }
        Relationships: []
      }
      skus: {
        Row: { id: string; tenant_id: string; colorway_id: string; size: string; sku_code: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id: string; colorway_id: string; size: string; sku_code: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; colorway_id?: string; size?: string; sku_code?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
    }
    Views: {
      style_summary: {
        Row: { id: string; tenant_id: string; code: string; name: string; collection: string | null; created_at: string; colorway_count: number; sku_count: number }
        Relationships: []
      }
    }
    Functions: {
      create_style_with_skus: {
        Args: {
          p_code: string; p_name: string; p_collection: string
          p_colorways: Json; p_sizes: string[]; p_overrides: Json
        }
        Returns: string
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
