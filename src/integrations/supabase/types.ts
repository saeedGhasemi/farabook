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
      ai_usage_log: {
        Row: {
          book_id: string | null
          created_at: string
          credits_charged: number
          id: string
          metadata: Json
          model: string | null
          operation: string
          usd_cost: number
          user_id: string
        }
        Insert: {
          book_id?: string | null
          created_at?: string
          credits_charged?: number
          id?: string
          metadata?: Json
          model?: string | null
          operation: string
          usd_cost?: number
          user_id: string
        }
        Update: {
          book_id?: string | null
          created_at?: string
          credits_charged?: number
          id?: string
          metadata?: Json
          model?: string | null
          operation?: string
          usd_cost?: number
          user_id?: string
        }
        Relationships: []
      }
      book_comments: {
        Row: {
          auto_flagged: boolean
          body: string
          book_id: string
          created_at: string
          edited: boolean
          flag_reason: string | null
          flag_rule: string | null
          id: string
          is_hidden: boolean
          parent_id: string | null
          rating: number | null
          updated_at: string
          user_id: string
        }
        Insert: {
          auto_flagged?: boolean
          body: string
          book_id: string
          created_at?: string
          edited?: boolean
          flag_reason?: string | null
          flag_rule?: string | null
          id?: string
          is_hidden?: boolean
          parent_id?: string | null
          rating?: number | null
          updated_at?: string
          user_id: string
        }
        Update: {
          auto_flagged?: boolean
          body?: string
          book_id?: string
          created_at?: string
          edited?: boolean
          flag_reason?: string | null
          flag_rule?: string | null
          id?: string
          is_hidden?: boolean
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
      book_revenue_shares: {
        Row: {
          book_id: string
          created_at: string
          id: string
          percent: number
          role: string
          user_id: string
        }
        Insert: {
          book_id: string
          created_at?: string
          id?: string
          percent: number
          role: string
          user_id: string
        }
        Update: {
          book_id?: string
          created_at?: string
          id?: string
          percent?: number
          role?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "book_revenue_shares_book_id_fkey"
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
          author_user_id: string | null
          book_type: string | null
          categories: string[] | null
          category: string | null
          comments_enabled: boolean
          contributors: Json
          cover_url: string | null
          created_at: string
          description: string | null
          edition: string | null
          first_published_paid: boolean
          id: string
          isbn: string | null
          language: string | null
          original_language: string | null
          original_title: string | null
          page_count: number | null
          pages: Json
          preview_pages: number[] | null
          price: number
          publication_year: number | null
          publish_complexity_factor: number | null
          published_at: string | null
          publisher: string | null
          publisher_id: string | null
          reject_reason: string | null
          review_status: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          series_index: number | null
          series_name: string | null
          slug: string | null
          status: string
          subjects: string[] | null
          subtitle: string | null
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
          author_user_id?: string | null
          book_type?: string | null
          categories?: string[] | null
          category?: string | null
          comments_enabled?: boolean
          contributors?: Json
          cover_url?: string | null
          created_at?: string
          description?: string | null
          edition?: string | null
          first_published_paid?: boolean
          id?: string
          isbn?: string | null
          language?: string | null
          original_language?: string | null
          original_title?: string | null
          page_count?: number | null
          pages?: Json
          preview_pages?: number[] | null
          price?: number
          publication_year?: number | null
          publish_complexity_factor?: number | null
          published_at?: string | null
          publisher?: string | null
          publisher_id?: string | null
          reject_reason?: string | null
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          series_index?: number | null
          series_name?: string | null
          slug?: string | null
          status?: string
          subjects?: string[] | null
          subtitle?: string | null
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
          author_user_id?: string | null
          book_type?: string | null
          categories?: string[] | null
          category?: string | null
          comments_enabled?: boolean
          contributors?: Json
          cover_url?: string | null
          created_at?: string
          description?: string | null
          edition?: string | null
          first_published_paid?: boolean
          id?: string
          isbn?: string | null
          language?: string | null
          original_language?: string | null
          original_title?: string | null
          page_count?: number | null
          pages?: Json
          preview_pages?: number[] | null
          price?: number
          publication_year?: number | null
          publish_complexity_factor?: number | null
          published_at?: string | null
          publisher?: string | null
          publisher_id?: string | null
          reject_reason?: string | null
          review_status?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          series_index?: number | null
          series_name?: string | null
          slug?: string | null
          status?: string
          subjects?: string[] | null
          subtitle?: string | null
          tags?: string[] | null
          title?: string
          title_en?: string | null
          typography_preset?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      comment_moderation_settings: {
        Row: {
          auto_hide: boolean
          block_links: boolean
          block_mentions: boolean
          id: number
          sensitive_words: string[]
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          auto_hide?: boolean
          block_links?: boolean
          block_mentions?: boolean
          id?: number
          sensitive_words?: string[]
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          auto_hide?: boolean
          block_links?: boolean
          block_mentions?: boolean
          id?: number
          sensitive_words?: string[]
          updated_at?: string
          updated_by?: string | null
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
      notifications: {
        Row: {
          body: string | null
          created_at: string
          id: string
          is_read: boolean
          link: string | null
          metadata: Json | null
          title: string
          type: string
          user_id: string
        }
        Insert: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          metadata?: Json | null
          title: string
          type: string
          user_id: string
        }
        Update: {
          body?: string | null
          created_at?: string
          id?: string
          is_read?: boolean
          link?: string | null
          metadata?: Json | null
          title?: string
          type?: string
          user_id?: string
        }
        Relationships: []
      }
      payment_orders: {
        Row: {
          amount_toman: number
          authority: string | null
          created_at: string
          credits: number
          description: string | null
          gateway: string
          id: string
          metadata: Json
          ref_id: string | null
          status: string
          updated_at: string
          user_id: string
        }
        Insert: {
          amount_toman: number
          authority?: string | null
          created_at?: string
          credits: number
          description?: string | null
          gateway?: string
          id?: string
          metadata?: Json
          ref_id?: string | null
          status?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          amount_toman?: number
          authority?: string | null
          created_at?: string
          credits?: number
          description?: string | null
          gateway?: string
          id?: string
          metadata?: Json
          ref_id?: string | null
          status?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
      platform_fee_settings: {
        Row: {
          ai_image_gen_cost: number
          ai_image_gen_usd: number
          ai_text_suggest_cost: number
          ai_text_suggest_usd: number
          book_publish_mode: string
          book_publish_value: number
          book_purchase_mode: string
          book_purchase_value: number
          credits_per_toman: number
          editor_order_mode: string
          editor_order_value: number
          id: number
          publisher_signup_mode: string
          publisher_signup_value: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          ai_image_gen_cost?: number
          ai_image_gen_usd?: number
          ai_text_suggest_cost?: number
          ai_text_suggest_usd?: number
          book_publish_mode?: string
          book_publish_value?: number
          book_purchase_mode?: string
          book_purchase_value?: number
          credits_per_toman?: number
          editor_order_mode?: string
          editor_order_value?: number
          id?: number
          publisher_signup_mode?: string
          publisher_signup_value?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          ai_image_gen_cost?: number
          ai_image_gen_usd?: number
          ai_text_suggest_cost?: number
          ai_text_suggest_usd?: number
          book_publish_mode?: string
          book_publish_value?: number
          book_purchase_mode?: string
          book_purchase_value?: number
          credits_per_toman?: number
          editor_order_mode?: string
          editor_order_value?: number
          id?: number
          publisher_signup_mode?: string
          publisher_signup_value?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: []
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
          is_active: boolean
          national_id: string | null
          phone: string | null
          phone_verified: boolean
          sms_notify_approvals: boolean
          sms_notify_credit: boolean
          sms_notify_purchase: boolean
          sms_notify_revenue: boolean
          updated_at: string
          username: string | null
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
          is_active?: boolean
          national_id?: string | null
          phone?: string | null
          phone_verified?: boolean
          sms_notify_approvals?: boolean
          sms_notify_credit?: boolean
          sms_notify_purchase?: boolean
          sms_notify_revenue?: boolean
          updated_at?: string
          username?: string | null
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
          is_active?: boolean
          national_id?: string | null
          phone?: string | null
          phone_verified?: boolean
          sms_notify_approvals?: boolean
          sms_notify_credit?: boolean
          sms_notify_purchase?: boolean
          sms_notify_revenue?: boolean
          updated_at?: string
          username?: string | null
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
      sms_log: {
        Row: {
          body: string
          created_at: string
          error: string | null
          event: string
          id: string
          phone: string
          provider_message_id: string | null
          status: string
          user_id: string | null
        }
        Insert: {
          body: string
          created_at?: string
          error?: string | null
          event: string
          id?: string
          phone: string
          provider_message_id?: string | null
          status?: string
          user_id?: string | null
        }
        Update: {
          body?: string
          created_at?: string
          error?: string | null
          event?: string
          id?: string
          phone?: string
          provider_message_id?: string | null
          status?: string
          user_id?: string | null
        }
        Relationships: []
      }
      sms_settings: {
        Row: {
          api_key: string | null
          api_password: string | null
          api_username: string | null
          custom_endpoint: string | null
          custom_payload_template: string | null
          enabled: boolean
          extra: Json
          id: number
          provider: string
          sender: string | null
          tpl_approval: string
          tpl_credit: string
          tpl_purchase: string
          tpl_revenue: string
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          api_key?: string | null
          api_password?: string | null
          api_username?: string | null
          custom_endpoint?: string | null
          custom_payload_template?: string | null
          enabled?: boolean
          extra?: Json
          id?: number
          provider?: string
          sender?: string | null
          tpl_approval?: string
          tpl_credit?: string
          tpl_purchase?: string
          tpl_revenue?: string
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          api_key?: string | null
          api_password?: string | null
          api_username?: string | null
          custom_endpoint?: string | null
          custom_payload_template?: string | null
          enabled?: boolean
          extra?: Json
          id?: number
          provider?: string
          sender?: string | null
          tpl_approval?: string
          tpl_credit?: string
          tpl_purchase?: string
          tpl_revenue?: string
          updated_at?: string
          updated_by?: string | null
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
      word_imports: {
        Row: {
          attempt_count: number
          author: string
          book_id: string | null
          chapters_count: number | null
          created_at: string
          description: string | null
          file_name: string
          file_path: string
          file_size: number
          id: string
          images_count: number | null
          last_error: string | null
          metadata: Json
          skipped_images_count: number | null
          status: string
          title: string
          updated_at: string
          user_id: string
        }
        Insert: {
          attempt_count?: number
          author?: string
          book_id?: string | null
          chapters_count?: number | null
          created_at?: string
          description?: string | null
          file_name: string
          file_path: string
          file_size?: number
          id?: string
          images_count?: number | null
          last_error?: string | null
          metadata?: Json
          skipped_images_count?: number | null
          status?: string
          title?: string
          updated_at?: string
          user_id: string
        }
        Update: {
          attempt_count?: number
          author?: string
          book_id?: string | null
          chapters_count?: number | null
          created_at?: string
          description?: string | null
          file_name?: string
          file_path?: string
          file_size?: number
          id?: string
          images_count?: number | null
          last_error?: string | null
          metadata?: Json
          skipped_images_count?: number | null
          status?: string
          title?: string
          updated_at?: string
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      public_profiles: {
        Row: {
          avatar_url: string | null
          bio: string | null
          created_at: string | null
          display_name: string | null
          id: string | null
          username: string | null
          website: string | null
        }
        Insert: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          username?: string | null
          website?: string | null
        }
        Update: {
          avatar_url?: string | null
          bio?: string | null
          created_at?: string | null
          display_name?: string | null
          id?: string | null
          username?: string | null
          website?: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      accept_editor_request: { Args: { _request_id: string }; Returns: string }
      admin_adjust_credits: {
        Args: { _amount: number; _reason: string; _user_id: string }
        Returns: undefined
      }
      admin_list_users: {
        Args: never
        Returns: {
          created_at: string
          credits: number
          display_name: string
          email: string
          id: string
          is_active: boolean
          national_id: string
          roles: string[]
          username: string
        }[]
      }
      admin_purge_user: { Args: { _user_id: string }; Returns: undefined }
      admin_recent_ai_usage: {
        Args: { _limit?: number }
        Returns: {
          book_id: string
          book_title: string
          created_at: string
          credits_charged: number
          id: string
          metadata: Json
          model: string
          operation: string
          usd_cost: number
          user_id: string
          user_name: string
        }[]
      }
      admin_recent_transactions: {
        Args: { _limit?: number }
        Returns: {
          amount: number
          book_id: string
          book_title: string
          buyer_id: string
          buyer_name: string
          created_at: string
          id: string
          metadata: Json
          reason: string
          user_email: string
          user_id: string
          user_name: string
        }[]
      }
      admin_set_role: {
        Args: {
          _grant: boolean
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: undefined
      }
      admin_update_platform_fees: {
        Args: { _settings: Json }
        Returns: {
          ai_image_gen_cost: number
          ai_image_gen_usd: number
          ai_text_suggest_cost: number
          ai_text_suggest_usd: number
          book_publish_mode: string
          book_publish_value: number
          book_purchase_mode: string
          book_purchase_value: number
          credits_per_toman: number
          editor_order_mode: string
          editor_order_value: number
          id: number
          publisher_signup_mode: string
          publisher_signup_value: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "platform_fee_settings"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      can_edit_book: {
        Args: { _book_id: string; _user_id: string }
        Returns: boolean
      }
      charge_ai_usage: {
        Args: {
          _book_id: string
          _metadata?: Json
          _model?: string
          _operation: string
        }
        Returns: Json
      }
      complete_payment_order: {
        Args: { _order_id: string; _ref_id: string }
        Returns: Json
      }
      compute_fee: {
        Args: { _base: number; _mode: string; _value: number }
        Returns: number
      }
      fail_payment_order: {
        Args: { _order_id: string; _reason: string }
        Returns: undefined
      }
      find_user_by_email: { Args: { _email: string }; Returns: string }
      get_public_fee_settings: { Args: never; Returns: Json }
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
      is_valid_iran_national_id: { Args: { _code: string }; Returns: boolean }
      normalize_iran_mobile: { Args: { _p: string }; Returns: string }
      publish_book_paid: {
        Args: { _book_id: string; _complexity?: number }
        Returns: Json
      }
      publisher_book_sales_stats: {
        Args: { _publisher_id: string }
        Returns: {
          book_id: string
          distribution: Json
          gross_credits: number
          sales_count: number
          to_publisher: number
        }[]
      }
      purchase_book: { Args: { _book_id: string }; Returns: Json }
      request_publisher_upgrade_paid: {
        Args: { _bio?: string; _display_name: string; _website?: string }
        Returns: Json
      }
      set_book_revenue_shares: {
        Args: { _book_id: string; _shares: Json }
        Returns: Json
      }
      update_book_pages_partial: {
        Args: { _book_id: string; _patches: Json }
        Returns: undefined
      }
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
