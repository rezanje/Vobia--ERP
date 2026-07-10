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
      locations: {
        Row: { id: string; tenant_id: string; name: string; is_default: boolean; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; is_default?: boolean; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; is_default?: boolean; active?: boolean; created_at?: string }
        Relationships: []
      }
      materials: {
        Row: { id: string; tenant_id: string; code: string; name: string; category: string; uom: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; code: string; name: string; category: string; uom: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; name?: string; category?: string; uom?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      material_ledger: {
        Row: { id: string; tenant_id: string; material_id: string; location_id: string; qty: number; movement_type: string; reason: string | null; ref_type: string | null; ref_id: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; material_id: string; location_id: string; qty: number; movement_type: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; material_id?: string; location_id?: string; qty?: number; movement_type?: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      stock_ledger: {
        Row: { id: string; tenant_id: string; sku_id: string; location_id: string; qty: number; movement_type: string; reason: string | null; ref_type: string | null; ref_id: string | null; created_by: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; sku_id: string; location_id: string; qty: number; movement_type: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; sku_id?: string; location_id?: string; qty?: number; movement_type?: string; reason?: string | null; ref_type?: string | null; ref_id?: string | null; created_by?: string | null; created_at?: string }
        Relationships: []
      }
      vendors: {
        Row: { id: string; tenant_id: string; name: string; contact: string | null; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; contact?: string | null; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; contact?: string | null; active?: boolean; created_at?: string }
        Relationships: []
      }
      production_orders: {
        Row: { id: string; tenant_id: string; code: string; style_id: string; vendor_id: string; stage: string; deadline: string | null; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; code: string; style_id: string; vendor_id: string; stage?: string; deadline?: string | null; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; style_id?: string; vendor_id?: string; stage?: string; deadline?: string | null; notes?: string | null; created_at?: string }
        Relationships: []
      }
      prod_lines: {
        Row: { id: string; tenant_id: string; po_id: string; sku_id: string; qty_ordered: number; qty_received: number; reject_count: number; created_at: string }
        Insert: { id?: string; tenant_id: string; po_id: string; sku_id: string; qty_ordered: number; qty_received?: number; reject_count?: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; po_id?: string; sku_id?: string; qty_ordered?: number; qty_received?: number; reject_count?: number; created_at?: string }
        Relationships: []
      }
      cost_entries: {
        Row: { id: string; tenant_id: string; po_id: string; cost_type: string; amount: number; note: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; po_id: string; cost_type: string; amount: number; note?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; po_id?: string; cost_type?: string; amount?: number; note?: string | null; created_at?: string }
        Relationships: []
      }
      channels: {
        Row: { id: string; tenant_id: string; name: string; active: boolean; created_at: string }
        Insert: { id?: string; tenant_id?: string; name: string; active?: boolean; created_at?: string }
        Update: { id?: string; tenant_id?: string; name?: string; active?: boolean; created_at?: string }
        Relationships: []
      }
      orders: {
        Row: { id: string; tenant_id: string; code: string; channel_id: string; order_date: string; customer: string | null; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id: string; code: string; channel_id: string; order_date?: string; customer?: string | null; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; channel_id?: string; order_date?: string; customer?: string | null; notes?: string | null; created_at?: string }
        Relationships: []
      }
      order_lines: {
        Row: { id: string; tenant_id: string; order_id: string; sku_id: string; qty: number; unit_price: number; created_at: string }
        Insert: { id?: string; tenant_id: string; order_id: string; sku_id: string; qty: number; unit_price?: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; order_id?: string; sku_id?: string; qty?: number; unit_price?: number; created_at?: string }
        Relationships: []
      }
      returns: {
        Row: { id: string; tenant_id: string; code: string; order_id: string; return_date: string; reason: string | null; notes: string | null; created_at: string }
        Insert: { id?: string; tenant_id?: string; code: string; order_id: string; return_date?: string; reason?: string | null; notes?: string | null; created_at?: string }
        Update: { id?: string; tenant_id?: string; code?: string; order_id?: string; return_date?: string; reason?: string | null; notes?: string | null; created_at?: string }
        Relationships: []
      }
      return_lines: {
        Row: { id: string; tenant_id: string; return_id: string; sku_id: string; qty: number; created_at: string }
        Insert: { id?: string; tenant_id: string; return_id: string; sku_id: string; qty: number; created_at?: string }
        Update: { id?: string; tenant_id?: string; return_id?: string; sku_id?: string; qty?: number; created_at?: string }
        Relationships: []
      }
    }
    Views: {
      style_summary: {
        Row: { id: string; tenant_id: string; code: string; name: string; collection: string | null; created_at: string; colorway_count: number; sku_count: number }
        Relationships: []
      }
      stock_balances: {
        Row: { sku_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
      stock_balances_by_location: {
        Row: { sku_id: string | null; location_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
      material_balances_by_location: {
        Row: { material_id: string | null; location_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
      material_balances: {
        Row: { material_id: string | null; tenant_id: string | null; balance: number | null }
        Relationships: []
      }
      sku_hpp: {
        Row: { tenant_id: string | null; sku_id: string | null; hpp: number | null; costed_units: number | null }
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
      record_movement: {
        Args: { p_sku_id: string; p_qty: number; p_movement_type: string; p_reason?: string; p_ref_type?: string; p_ref_id?: string; p_location_id?: string }
        Returns: string
      }
      record_material_movement: {
        Args: { p_material_id: string; p_qty: number; p_movement_type: string; p_reason?: string; p_ref_type?: string; p_ref_id?: string; p_location_id?: string }
        Returns: string
      }
      record_transfer: {
        Args: { p_sku_id: string; p_qty: number; p_from_location: string; p_to_location: string; p_reason?: string }
        Returns: undefined
      }
      create_production_order: {
        Args: { p_style_id: string; p_vendor_id: string; p_deadline?: string | null; p_notes: string; p_lines: Json }
        Returns: string
      }
      transition_production_stage: {
        Args: { p_po_id: string; p_next_stage: string }
        Returns: undefined
      }
      create_order: {
        Args: { p_channel_id: string; p_order_date?: string | null; p_customer: string; p_notes: string; p_lines: Json }
        Returns: string
      }
      create_return: {
        Args: { p_order_id: string; p_return_date?: string | null; p_reason: string; p_notes: string; p_lines: Json }
        Returns: string
      }
    }
    Enums: { [_ in never]: never }
    CompositeTypes: { [_ in never]: never }
  }
}
