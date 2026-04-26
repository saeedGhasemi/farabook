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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      book_comments: {
        Row: {
          body: string
          book_id: string
          created_at: string
          edited: boolean
          id: string
          parent_id: string | null
          rating: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          body: string
          book_id: string
          created_at?: string
          edited?: boolean
          id?: string
          parent_id?: string | null
          rating?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          body?: string
          book_id?: string
          created_at?: string
          edited?: boolean
          id?: string
          parent_id?: string | null
          rating?: number | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_comments_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "book_comments_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "book_comments"
            referencedColumns: ["id"]
          },
        ]
      }
      book_editors: {
        Row: {
          book_id: string
          can_publish: boolean
          created_at: string
          editor_id: string
          granted_by: string
          id: string
        }
        Insert: {
          book_id: string
          can_publish?: boolean
          created_at?: string
          editor_id: string
          granted_by: string
          id?: string
        }
        Update: {
          book_id?: string
          can_publish?: boolean
          created_at?: string
          editor_id?: string
          granted_by?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_editors_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      book_reviews: {
        Row: {
          body: string
          book_id: string
          created_at: string
          id: string
          is_official: boolean
          rating: number | null
          reviewer_id: string
          title: string | null
        }
        Insert: {
          body: string
          book_id: string
          created_at?: string
          id?: string
          is_official?: boolean
          rating?: number | null
          reviewer_id: string
          title?: string | null
        }
        Update: {
          body?: string
          book_id?: string
          created_at?: string
          id?: string
          is_official?: boolean
          rating?: number | null
          reviewer_id?: string
          title?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "book_reviews_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      books: {
        Row: {
          ai_audio_url: string | null
          ai_summary: string | null
          ambient_theme: string | null
          audience: string | null
          author: string
          category: string | null
          cover_url: string | null
          created_at: string
          description: string | null
          id: string
          isbn: string | null
          language: string | null
          pages: Json
          preview_pages: number[] | null
          price: number
          published_at: string | null
          publisher: string | null
          publisher_id: string | null
          reject_reason: string | null
          review_status: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          slug: string | null
          status: string
          tags: string[] | null
          title: string
          title_en: string | null
          typography_preset: string | null
          updated_at: string
        }
        Insert: {
          ai_audio_url?: string | null
          ai_summary?: string | null
          ambient_theme?: string | null
          audience?: string | null
          author: string
          category?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          isbn?: string | null
          language?: string | null
          pages?: Json
          preview_pages?: number[] | null
          price?: number
          published_at?: string | null
          publisher?: string | null
          publisher_id?: string | null
          reject_reason?: string | null
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slug?: string | null
          status?: string
          tags?: string[] | null
          title: string
          title_en?: string | null
          typography_preset?: string | null
          updated_at?: string
        }
        Update: {
          ai_audio_url?: string | null
          ai_summary?: string | null
          ambient_theme?: string | null
          audience?: string | null
          author?: string
          category?: string | null
          cover_url?: string | null
          created_at?: string
          description?: string | null
          id?: string
          isbn?: string | null
          language?: string | null
          pages?: Json
          preview_pages?: number[] | null
          price?: number
          published_at?: string | null
          publisher?: string | null
          publisher_id?: string | null
          reject_reason?: string | null
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          slug?: string | null
          status?: string
          tags?: string[] | null
          title?: string
          title_en?: string | null
          typography_preset?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      credit_purchase_requests: {
        Row: {
          amount: number
          created_at: string
          id: string
          note: string | null
          payment_reference: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          id?: string
          note?: string | null
          payment_reference?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          id?: string
          note?: string | null
          payment_reference?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
        }
        Relationships: []
      }
      credit_transactions: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          id: string
          metadata: Json | null
          reason: string
          user_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          reason: string
          user_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          id?: string
          metadata?: Json | null
          reason?: string
          user_id?: string
        }
        Relationships: []
      }
      editor_access_requests: {
        Row: {
          book_id: string
          can_publish: boolean
          created_at: string
          editor_email: string
          editor_user_id: string | null
          id: string
          message: string | null
          publisher_id: string
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          updated_at: string
        }
        Insert: {
          book_id: string
          can_publish?: boolean
          created_at?: string
          editor_email: string
          editor_user_id?: string | null
          id?: string
          message?: string | null
          publisher_id: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          book_id?: string
          can_publish?: boolean
          created_at?: string
          editor_email?: string
          editor_user_id?: string | null
          id?: string
          message?: string | null
          publisher_id?: string
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "editor_access_requests_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      highlights: {
        Row: {
          book_id: string
          color: string
          created_at: string
          id: string
          is_public: boolean
          note: string | null
          page_index: number
          text: string
          user_id: string
        }
        Insert: {
          book_id: string
          color?: string
          created_at?: string
          id?: string
          is_public?: boolean
          note?: string | null
          page_index: number
          text: string
          user_id: string
        }
        Update: {
          book_id?: string
          color?: string
          created_at?: string
          id?: string
          is_public?: boolean
          note?: string | null
          page_index?: number
          text?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "highlights_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          contact_email: string | null
          contact_phone: string | null
          created_at: string
          credits: number
          display_name: string | null
          id: string
          updated_at: string
          website: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          credits?: number
          display_name?: string | null
          id: string
          updated_at?: string
          website?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          contact_email?: string | null
          contact_phone?: string | null
          created_at?: string
          credits?: number
          display_name?: string | null
          id?: string
          updated_at?: string
          website?: string | null
        }
        Relationships: []
      }
      publisher_profiles: {
        Row: {
          banner_url: string | null
          bio: string | null
          created_at: string
          display_name: string
          id: string
          is_active: boolean
          is_trusted: boolean
          logo_url: string | null
          slug: string
          theme: string | null
          updated_at: string
          user_id: string
          website: string | null
        }
        Insert: {
          banner_url?: string | null
          bio?: string | null
          created_at?: string
          display_name: string
          id?: string
          is_active?: boolean
          is_trusted?: boolean
          logo_url?: string | null
          slug: string
          theme?: string | null
          updated_at?: string
          user_id: string
          website?: string | null
        }
        Update: {
          banner_url?: string | null
          bio?: string | null
          created_at?: string
          display_name?: string
          id?: string
          is_active?: boolean
          is_trusted?: boolean
          logo_url?: string | null
          slug?: string
          theme?: string | null
          updated_at?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      publisher_upgrade_requests: {
        Row: {
          bio: string | null
          created_at: string
          credits_offered: number
          display_name: string
          id: string
          reject_reason: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: string
          user_id: string
          website: string | null
        }
        Insert: {
          bio?: string | null
          created_at?: string
          credits_offered?: number
          display_name: string
          id?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id: string
          website?: string | null
        }
        Update: {
          bio?: string | null
          created_at?: string
          credits_offered?: number
          display_name?: string
          id?: string
          reject_reason?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: string
          user_id?: string
          website?: string | null
        }
        Relationships: []
      }
      user_books: {
        Row: {
          acquired_via: string
          book_id: string
          created_at: string
          current_page: number
          id: string
          lent_to: string | null
          lent_until: string | null
          progress: number
          status: string
          user_id: string
        }
        Insert: {
          acquired_via?: string
          book_id: string
          created_at?: string
          current_page?: number
          id?: string
          lent_to?: string | null
          lent_until?: string | null
          progress?: number
          status?: string
          user_id: string
        }
        Update: {
          acquired_via?: string
          book_id?: string
          created_at?: string
          current_page?: number
          id?: string
          lent_to?: string | null
          lent_until?: string | null
          progress?: number
          status?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "user_books_book_id_fkey"
            columns: ["book_id"]
            isOneToOne: false
            referencedRelation: "books"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          created_at: string
          granted_by: string | null
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          created_at?: string
          granted_by?: string | null
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_editor_request: { Args: { _request_id: string }; Returns: string }
      can_edit_book: {
        Args: { _book_id: string; _user_id: string }
        Returns: boolean
      }
      find_user_by_email: { Args: { _email: string }; Returns: string }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_admin: { Args: { _user_id: string }; Returns: boolean }
      is_publisher: { Args: { _user_id: string }; Returns: boolean }
      is_super_admin: { Args: { _user_id: string }; Returns: boolean }
    }
    Enums: {
      app_role:
        | "super_admin"
        | "admin"
        | "moderator"
        | "reviewer"
        | "publisher"
        | "editor"
        | "user"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: [
        "super_admin",
        "admin",
        "moderator",
        "reviewer",
        "publisher",
        "editor",
        "user",
      ],
    },
  },
} as const
