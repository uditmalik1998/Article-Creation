
import type { SchemaItem, EnhancedExtractionResult } from '../../types/extraction/ExtractionTypes';
import { APP_CONFIG } from '../../constants/app/config';
import { clearAuthSession, redirectToLoginOnce } from '../../shared/utils/auth/navigation';

export interface BackendExtractionRequest {
  image: string; // base64 encoded image
  schema: SchemaItem[];
  categoryName?: string;
  customPrompt?: string;
  discoveryMode?: boolean;
  fileName?: string; // Original filename for backend to use in saving
  folderName?: string; // Folder name for vendor code derivation
  presentationsType?: string;
}

export interface BackendExtractionResponse {
  success: boolean;
  data?: EnhancedExtractionResult;
  error?: string;
  timestamp: number;
  metadata?: {
    enhancedMode?: boolean;
    vlmPipeline?: string;
    fashionSpecialized?: boolean;
  };
}

export class BackendApiService {
  private baseURL: string;

  constructor() {
    this.baseURL = APP_CONFIG.api.baseURL;
  }

  /**
   * Get auth headers for API requests
   */
  private getAuthHeaders(): HeadersInit {
    const token = localStorage.getItem('authToken');
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
    };

    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    return headers;
  }

  /**
   * Handle auth errors and redirect to login
   */
  private handleAuthError(response: Response): void {
    if (response.status === 401) {
      console.warn('🔐 Authentication required - redirecting to login');
      clearAuthSession();
      redirectToLoginOnce();
    } else if (response.status === 403) {
      console.error('🚫 Access denied - insufficient permissions');
    }
  }

  // ENHANCED VLM EXTRACTION (New Primary Method - Updated to use /api/user/*)
  async extractFromBase64VLM(request: BackendExtractionRequest): Promise<EnhancedExtractionResult> {
    try {
      console.log(`Enhanced VLM Extraction - Discovery: ${request.discoveryMode || false}, Category: ${request.categoryName}`);

      // Updated endpoint: /api/user/extract/base64
      const response = await fetch(`${this.baseURL}/user/extract/base64`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          ...request,
          discoveryMode: request.discoveryMode || false
        })
      });

      // Handle auth errors
      if (response.status === 401 || response.status === 403) {
        this.handleAuthError(response);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Enhanced VLM API request failed: ${response.status}`);
      }

      const result: BackendExtractionResponse = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Enhanced VLM extraction failed');
      }

      if (!result.data) {
        throw new Error('No data returned from enhanced VLM extraction');
      }

      console.log(`✅ Enhanced VLM Success - Confidence: ${result.data.confidence}%, Model: ${result.data.modelUsed}`);
      return result.data;
    } catch (error) {
      console.error('Enhanced VLM extraction failed:', error);
      throw new Error(`Enhanced VLM extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // 📊 VLM SYSTEM HEALTH CHECK
  async vlmHealthCheck(): Promise<{ success: boolean; message: string; data: Record<string, unknown> }> {
    try {
      const response = await fetch(`${this.baseURL}/vlm/health`);

      if (!response.ok) {
        throw new Error(`VLM health check failed: ${response.status}`);
      }

      return await response.json();
    } catch (error) {
      console.error('VLM health check failed:', error);
      throw new Error(`VLM health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // LEGACY METHOD (Keep for backward compatibility - Updated with auth)
  async extractFromBase64(request: BackendExtractionRequest): Promise<EnhancedExtractionResult> {
    try {
      console.log(`🔍 Legacy API Call - Discovery Mode: ${request.discoveryMode || false}`);

      // Updated endpoint: /api/user/extract/base64 (same as VLM for consistency)
      const response = await fetch(`${this.baseURL}/user/extract/base64`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify({
          ...request,
          discoveryMode: request.discoveryMode || false
        })
      });

      // Handle auth errors
      if (response.status === 401 || response.status === 403) {
        this.handleAuthError(response);
      }

      if (!response.ok) {
        const rawText = await response.text().catch(() => '');
        let errorData: any = {};
        try {
          errorData = rawText ? JSON.parse(rawText) : {};
        } catch {
          errorData = { error: rawText };
        }
        const detail = errorData.error || errorData.message || rawText || `API request failed: ${response.status}`;
        console.error('Backend API error response:', {
          status: response.status,
          statusText: response.statusText,
          detail
        });
        throw new Error(detail);
      }

      const result: BackendExtractionResponse = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Extraction failed');
      }

      if (!result.data) {
        throw new Error('No data returned from extraction');
      }

      return result.data;
    } catch (error) {
      console.error('Backend API extraction failed:', error);
      throw new Error(`Extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async extractFromFile(file: File, schema: SchemaItem[], categoryName?: string, discoveryMode = false): Promise<EnhancedExtractionResult> {
    try {
      const token = localStorage.getItem('authToken');
      const relativePath = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || '').trim();
      const folderName = relativePath.includes('/') ? relativePath.split('/')[0] : '';

      const formData = new FormData();
      formData.append('image', file);
      formData.append('schema', JSON.stringify(schema));

      if (categoryName) {
        formData.append('categoryName', categoryName);
      }

      if (discoveryMode) {
        formData.append('discoveryMode', 'true');
      }

      if (folderName) {
        formData.append('folderName', folderName);
      }

      // Updated endpoint: /api/user/extract/upload
      const response = await fetch(`${this.baseURL}/user/extract/upload`, {
        method: 'POST',
        headers: {
          'Authorization': token ? `Bearer ${token}` : '',
        },
        body: formData
      });

      // Handle auth errors
      if (response.status === 401 || response.status === 403) {
        this.handleAuthError(response);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `API request failed: ${response.status}`);
      }

      const result: BackendExtractionResponse = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Extraction failed');
      }

      if (!result.data) {
        throw new Error('No data returned from extraction');
      }

      return result.data;
    } catch (error) {
      console.error('Backend API file extraction failed:', error);
      throw new Error(`File extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  // 🔍 MULTI-CROP ENHANCED EXTRACTION
  async extractWithMultiCrop({
    file,
    schema,
    categoryName,
    department,
    subDepartment
  }: {
    file: File;
    schema: SchemaItem[];
    categoryName?: string;
    department?: string;
    subDepartment?: string;
  }): Promise<EnhancedExtractionResult> {
    try {
      console.log('🔍 Multi-crop API call:', { fileName: file.name, category: categoryName });
      const relativePath = ((file as File & { webkitRelativePath?: string }).webkitRelativePath || '').trim();
      const folderName = relativePath.includes('/') ? relativePath.split('/')[0] : '';

      const formData = new FormData();
      formData.append('image', file);
      formData.append('schema', JSON.stringify(schema));

      if (categoryName) {
        formData.append('categoryName', categoryName);
      }

      if (department) {
        formData.append('department', department);
      }

      if (subDepartment) {
        formData.append('subDepartment', subDepartment);
      }

      if (folderName) {
        formData.append('folderName', folderName);
      }

      const response = await fetch(`${this.baseURL}/extract/multi-crop`, {
        method: 'POST',
        body: formData
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Multi-crop API request failed: ${response.status}`);
      }

      const result: BackendExtractionResponse = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Multi-crop extraction failed');
      }

      if (!result.data) {
        throw new Error('No data returned from multi-crop extraction');
      }

      console.log('✅ Multi-crop extraction successful:', {
        confidence: result.data.confidence,
        tokensUsed: result.data.tokensUsed,
        discoveries: result.data.discoveries?.length ?? 0
      });

      return result.data;
    } catch (error) {
      console.error('Backend API multi-crop extraction failed:', error);
      throw new Error(`Multi-crop extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  async healthCheck(): Promise<{ success: boolean; message: string; version: string }> {
    try {
      const response = await fetch(`${this.baseURL}/health`);

      if (!response.ok) {
        throw new Error(`Health check failed: ${response.status}`);
      }

      const result = await response.json();
      return result;
    } catch (error) {
      console.error('Backend health check failed:', error);
      throw new Error(`Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  isConfigured(): boolean {
    return !!this.baseURL;
  }

  // REMOVED: Upload management endpoints - no longer used
  // async listUploads(page = 1, pageSize = 20) { ... }
  // async getUpload(id: string) { ... }
  // async updateUpload(id: string, data: ...) { ... }
  // async deleteUpload(id: string) { ... }

  async getAdminStats() {
    const token = localStorage.getItem('authToken');
    const resp = await fetch(`${this.baseURL}/admin/stats`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!resp.ok) throw new Error(`Failed to fetch admin stats: ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Failed to get admin stats');
    return json.data;
  }

  async getExpenseAnalytics(options?: { dateFrom?: string; dateTo?: string; status?: string }) {
    const token = localStorage.getItem('authToken');
    const params = new URLSearchParams();
    if (options?.dateFrom) params.append('dateFrom', options.dateFrom);
    if (options?.dateTo) params.append('dateTo', options.dateTo);
    if (options?.status) params.append('status', options.status);

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetch(`${this.baseURL}/admin/analytics/expenses${queryString}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!resp.ok) throw new Error(`Failed to fetch expense analytics: ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Failed to get expense analytics');
    return json.data;
  }

  async getImageUsageAnalytics(options?: { dateFrom?: string; dateTo?: string; status?: string; categoryId?: number }) {
    const token = localStorage.getItem('authToken');
    const params = new URLSearchParams();
    if (options?.dateFrom) params.append('dateFrom', options.dateFrom);
    if (options?.dateTo) params.append('dateTo', options.dateTo);
    if (options?.status) params.append('status', options.status);
    if (options?.categoryId) params.append('categoryId', options.categoryId.toString());

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetch(`${this.baseURL}/admin/analytics/image-usage${queryString}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!resp.ok) throw new Error(`Failed to fetch image usage analytics: ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Failed to get image usage analytics');
    return json.data;
  }

  async getDetailedExpenses(options?: { limit?: number; offset?: number }) {
    const token = localStorage.getItem('authToken');
    const params = new URLSearchParams();
    if (options?.limit) params.append('limit', options.limit.toString());
    if (options?.offset) params.append('offset', options.offset.toString());

    const queryString = params.toString() ? `?${params.toString()}` : '';
    const resp = await fetch(`${this.baseURL}/admin/analytics/expenses/detailed${queryString}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });
    if (!resp.ok) throw new Error(`Failed to fetch detailed expenses: ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Failed to get detailed expenses');
    return json.data;
  }

  async login(email: string, password: string) {
    const resp = await fetch(`${this.baseURL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!resp.ok) throw new Error(`Login failed: ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Login failed');
    return json.data;
  }

  async register(email: string, password: string, name?: string, role?: string, division?: string, subDivision?: string) {
    const resp = await fetch(`${this.baseURL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, name, role, division, subDivision }),
    });
    if (!resp.ok) throw new Error(`Registration failed: ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Registration failed');
    return json.data;
  }

  async getMe() {
    const token = localStorage.getItem('authToken');
    const resp = await fetch(`${this.baseURL}/auth/me`, {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (!resp.ok) throw new Error(`Failed to get user info: ${resp.status}`);
    const json = await resp.json();
    if (!json.success) throw new Error(json.error || 'Failed to get user info');
    return json.data;
  }

  // NEW: Category-Based Extraction with Metadata
  async extractWithCategory(request: {
    image: string;
    categoryCode: string;
    vendorName?: string;
    designNumber?: string;
    pptNumber?: string;
    costPrice?: number;
    sellingPrice?: number;
    notes?: string;
    discoveryMode?: boolean;
    customPrompt?: string;
    fileName?: string;
    folderName?: string;
  }): Promise<EnhancedExtractionResult & {
    category: {
      code: string;
      name: string;
      fullForm: string | null;
      department: string;
      subDepartment: string;
    };
    metadata: {
      vendorName?: string;
      designNumber?: string;
      pptNumber?: string;
      costPrice?: number;
      sellingPrice?: number;
      notes?: string;
    };
  }> {
    try {
      console.log(`Category-Based Extraction - Code: ${request.categoryCode}, Discovery: ${request.discoveryMode || false}`);

      // Updated endpoint: /api/user/extract/category
      const response = await fetch(`${this.baseURL}/user/extract/category`, {
        method: 'POST',
        headers: this.getAuthHeaders(),
        body: JSON.stringify(request)
      });

      // Handle auth errors
      if (response.status === 401 || response.status === 403) {
        this.handleAuthError(response);
      }

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || `Category extraction failed: ${response.status}`);
      }

      const result = await response.json();

      if (!result.success) {
        throw new Error(result.error || 'Category extraction failed');
      }

      if (!result.data) {
        throw new Error('No data returned from category extraction');
      }

      console.log(`✅ Category Extraction Success - ${result.data.category.name}, Confidence: ${result.data.confidence}%`);
      return result.data;
    } catch (error) {
      console.error('Category extraction failed:', error);
      throw new Error(`Category extraction failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }
}