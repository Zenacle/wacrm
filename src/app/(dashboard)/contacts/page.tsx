'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { createClient } from '@/lib/supabase/client';
import { toast } from 'sonner';
import type { Contact, Tag, ContactTag } from '@/types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Search,
  Plus,
  Upload,
  MoreHorizontal,
  Pencil,
  Trash2,
  Loader2,
  Users,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
} from 'lucide-react';
import { ContactForm } from '@/components/contacts/contact-form';
import { ContactDetailView } from '@/components/contacts/contact-detail-view';
import { ImportModal } from '@/components/contacts/import-modal';

const PAGE_SIZE = 25;

interface ContactWithTags extends Contact {
  tags?: Tag[];
}

export default function ContactsPage() {
  const supabase = createClient();

  const [contacts, setContacts] = useState<ContactWithTags[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

   // Bulk actions state
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkActionLoading, setBulkActionLoading] = useState(false);
  const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);
  const [drawerSyncKey, setDrawerSyncKey] = useState(0);

  const selectedIdsRef = useRef(selectedIds);
  useEffect(() => {
    selectedIdsRef.current = selectedIds;
  }, [selectedIds]);

  // Modals
  const [formOpen, setFormOpen] = useState(false);
  const [editContact, setEditContact] = useState<Contact | null>(null);
  const [editContactTags, setEditContactTags] = useState<ContactTag[]>([]);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailContactId, setDetailContactId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Contact | null>(null);
  const [deleting, setDeleting] = useState(false);

  // All tags for display
  const [tagsMap, setTagsMap] = useState<Record<string, Tag>>({});

  const fetchTags = useCallback(async () => {
    const { data } = await supabase.from('tags').select('*');
    if (data) {
      const map: Record<string, Tag> = {};
      data.forEach((t) => (map[t.id] = t));
      setTagsMap(map);
    }
  }, [supabase]);

  const fetchContacts = useCallback(async () => {
    setLoading(true);

    const from = page * PAGE_SIZE;
    const to = from + PAGE_SIZE - 1;

    let query = supabase
      .from('contacts')
      .select('*', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(from, to);

    if (search.trim()) {
      const term = `%${search.trim()}%`;
      query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
    }

    if (showSelectedOnly) {
      const activeIds = selectedIdsRef.current;
      if (activeIds.length === 0) {
        setContacts([]);
        setTotalCount(0);
        setLoading(false);
        return;
      }
      query = query.in('id', activeIds);
    }

    const { data, count, error } = await query;

    if (error) {
      toast.error('Failed to load contacts');
      setLoading(false);
      return;
    }

    setTotalCount(count ?? 0);

    if (!data || data.length === 0) {
      setContacts([]);
      setLoading(false);
      return;
    }

    // Fetch tags for these contacts
    const contactIds = data.map((c) => c.id);
    const { data: contactTags } = await supabase
      .from('contact_tags')
      .select('contact_id, tag_id')
      .in('contact_id', contactIds);

    const tagsByContact: Record<string, string[]> = {};
    contactTags?.forEach((ct) => {
      if (!tagsByContact[ct.contact_id]) tagsByContact[ct.contact_id] = [];
      tagsByContact[ct.contact_id].push(ct.tag_id);
    });

    const enriched: ContactWithTags[] = data.map((c) => ({
      ...c,
      tags: (tagsByContact[c.id] ?? [])
        .map((tid) => tagsMap[tid])
        .filter(Boolean),
    }));

    setContacts(enriched);
    setLoading(false);
  }, [supabase, page, search, tagsMap, showSelectedOnly]);

  // Load-once-on-mount-ish data fetches. Each setter inside runs
  // inside an async promise completion (Supabase await), not
  // synchronously in the effect body, so the cascade the lint rule
  // warns about doesn't apply here.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchTags();
  }, [fetchTags]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContacts();
  }, [fetchContacts]);

  // Refetch only when selectedIds changes AND showSelectedOnly is true
  useEffect(() => {
    if (showSelectedOnly) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchContacts();
    }
  }, [selectedIds, showSelectedOnly, fetchContacts]);

  // Auto-disable showSelectedOnly if selection becomes empty
  useEffect(() => {
    if (selectedIds.length === 0 && showSelectedOnly) {
      setShowSelectedOnly(false);
    }
  }, [selectedIds, showSelectedOnly]);

  function openAddForm() {
    setEditContact(null);
    setEditContactTags([]);
    setFormOpen(true);
  }

  async function openEditForm(contact: Contact) {
    const { data } = await supabase
      .from('contact_tags')
      .select('*')
      .eq('contact_id', contact.id);
    setEditContact(contact);
    setEditContactTags(data ?? []);
    setFormOpen(true);
  }

  function openDetail(contactId: string) {
    setDetailContactId(contactId);
    setDetailOpen(true);
  }

  function confirmDelete(contact: Contact) {
    setDeleteTarget(contact);
    setDeleteConfirmOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setDeleting(true);

    const { error } = await supabase
      .from('contacts')
      .delete()
      .eq('id', deleteTarget.id);

    if (error) {
      toast.error('Failed to delete contact');
    } else {
      toast.success('Contact deleted');
      setSelectedIds((prev) => prev.filter((id) => id !== deleteTarget.id));
      fetchContacts();
    }

    setDeleting(false);
    setDeleteConfirmOpen(false);
    setDeleteTarget(null);
  }

  // Bulk action handlers
  async function handleBulkAddTag(tagId: string) {
    if (selectedIds.length === 0) return;
    setBulkActionLoading(true);
    try {
      const rows = selectedIds.map((cid) => ({
        contact_id: cid,
        tag_id: tagId,
      }));

      const chunkSize = 100;
      for (let i = 0; i < rows.length; i += chunkSize) {
        const chunk = rows.slice(i, i + chunkSize);
        const { error } = await supabase
          .from('contact_tags')
          .upsert(chunk, { onConflict: 'contact_id,tag_id' });
        if (error) throw error;
      }

      toast.success(`Tag added to ${selectedIds.length} contact${selectedIds.length !== 1 ? 's' : ''}`);
      fetchContacts();
      setDrawerSyncKey((prev) => prev + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to add tags';
      toast.error(msg);
    } finally {
      setBulkActionLoading(false);
    }
  }

  async function handleBulkRemoveTag(tagId: string) {
    if (selectedIds.length === 0) return;
    setBulkActionLoading(true);
    try {
      const chunkSize = 100;
      for (let i = 0; i < selectedIds.length; i += chunkSize) {
        const chunk = selectedIds.slice(i, i + chunkSize);
        const { error } = await supabase
          .from('contact_tags')
          .delete()
          .in('contact_id', chunk)
          .eq('tag_id', tagId);
        if (error) throw error;
      }

      toast.success(`Tag removed from ${selectedIds.length} contact${selectedIds.length !== 1 ? 's' : ''}`);
      fetchContacts();
      setDrawerSyncKey((prev) => prev + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove tags';
      toast.error(msg);
    } finally {
      setBulkActionLoading(false);
    }
  }

  async function handleBulkDelete() {
    if (selectedIds.length === 0) return;
    setDeleting(true);
    try {
      const chunkSize = 100;
      for (let i = 0; i < selectedIds.length; i += chunkSize) {
        const chunk = selectedIds.slice(i, i + chunkSize);
        const { error } = await supabase
          .from('contacts')
          .delete()
          .in('id', chunk);
        if (error) throw error;
      }

      toast.success(`Deleted ${selectedIds.length} contact${selectedIds.length !== 1 ? 's' : ''}`);
      setSelectedIds([]);
      fetchContacts();
      setDrawerSyncKey((prev) => prev + 1);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to delete contacts';
      toast.error(msg);
    } finally {
      setDeleting(false);
      setBulkDeleteConfirmOpen(false);
    }
  }

  async function handleSelectAllMatches() {
    setSelectingAll(true);
    try {
      let query = supabase.from('contacts').select('id');
      if (search.trim()) {
        const term = `%${search.trim()}%`;
        query = query.or(`name.ilike.${term},phone.ilike.${term},email.ilike.${term}`);
      }
      const { data, error } = await query;
      if (error) throw error;
      if (data) {
        setSelectedIds(data.map((c) => c.id));
        toast.success(`Selected all ${data.length} contacts`);
      }
    } catch (err: unknown) {
      toast.error('Failed to select all contacts');
    } finally {
      setSelectingAll(false);
    }
  }

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
  };

  const handleSearchChange = (val: string) => {
    setSearch(val);
    setPage(0);
  };

  const totalPages = Math.ceil(totalCount / PAGE_SIZE);
  const hasNext = page < totalPages - 1;
  const hasPrev = page > 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Contacts</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Manage your contact list. {totalCount > 0 && `${totalCount} total contacts.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setImportOpen(true)}
            className="border-border hover:bg-accent text-muted-foreground hover:text-foreground"
          >
            <Upload className="size-4" />
            Import
          </Button>
          <Button
            onClick={openAddForm}
          >
            <Plus className="size-4" />
            Add Contact
          </Button>
        </div>
      </div>

      {/* Search & Bulk Actions */}
      <div className="flex flex-row flex-wrap items-center justify-between gap-4">
        <div className="relative max-w-sm w-full md:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => handleSearchChange(e.target.value)}
            placeholder="Search by name, phone, or email..."
            className="pl-9 bg-muted/30 border-border text-foreground placeholder:text-muted-foreground focus:border-brand-cyan/50 focus:ring-1 focus:ring-brand-cyan/50 rounded-xl"
          />
        </div>

        {/* Bulk Actions Bar */}
        {selectedIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 h-8 px-2.5 rounded-xl border border-brand-teal/20 dark:border-brand-cyan/20 bg-brand-teal/5 dark:bg-brand-cyan/5 text-foreground animate-in fade-in slide-in-from-right-2 duration-200 ml-auto">
            <span className="text-xs font-semibold text-brand-teal dark:text-brand-cyan whitespace-nowrap pr-2 border-r border-border mr-0.5">
              {selectedIds.length} selected
            </span>
            {selectedIds.length < totalCount && contacts.length > 0 && contacts.every((c) => selectedIds.includes(c.id)) && (
              <button
                onClick={handleSelectAllMatches}
                disabled={selectingAll}
                className="text-xs text-brand-teal dark:text-brand-cyan hover:underline font-semibold cursor-pointer mr-1.5 whitespace-nowrap"
              >
                {selectingAll ? 'Selecting...' : `Select all ${totalCount} contacts`}
              </button>
            )}

            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setShowSelectedOnly(!showSelectedOnly);
                setPage(0);
              }}
              className={cn(
                "border-border hover:bg-accent hover:text-foreground transition-all duration-200",
                showSelectedOnly 
                  ? "bg-brand-teal/20 text-brand-teal dark:bg-brand-cyan/20 dark:text-brand-cyan border-brand-teal/30 dark:border-brand-cyan/30 font-semibold" 
                  : "text-muted-foreground"
              )}
            >
              {showSelectedOnly ? "Show All" : "Show Selected"}
            </Button>
            
            {/* Add Tag */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="xs"
                    className="border-border hover:bg-accent text-muted-foreground hover:text-foreground"
                    disabled={bulkActionLoading}
                  />
                }
              >
                <Plus className="size-3" />
                Add Tag
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-card border-border shadow-lg rounded-xl text-card-foreground max-h-60 overflow-y-auto"
              >
                {Object.values(tagsMap).length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground">No tags available</div>
                ) : (
                  Object.values(tagsMap).map((tag) => (
                    <DropdownMenuItem
                      key={tag.id}
                      onClick={() => handleBulkAddTag(tag.id)}
                      className="focus:bg-accent focus:text-accent-foreground cursor-pointer flex items-center gap-2"
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Remove Tag */}
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    variant="outline"
                    size="xs"
                    className="border-border hover:bg-accent text-muted-foreground hover:text-foreground"
                    disabled={bulkActionLoading}
                  />
                }
              >
                <Trash2 className="size-3" />
                Remove Tag
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                className="bg-card border-border shadow-lg rounded-xl text-card-foreground max-h-60 overflow-y-auto"
              >
                {Object.values(tagsMap).length === 0 ? (
                  <div className="p-2 text-xs text-muted-foreground">No tags available</div>
                ) : (
                  Object.values(tagsMap).map((tag) => (
                    <DropdownMenuItem
                      key={tag.id}
                      onClick={() => handleBulkRemoveTag(tag.id)}
                      className="focus:bg-accent focus:text-accent-foreground cursor-pointer flex items-center gap-2"
                    >
                      <span className="size-2 rounded-full" style={{ backgroundColor: tag.color }} />
                      {tag.name}
                    </DropdownMenuItem>
                  ))
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Delete button */}
            <Button
              variant="destructive"
              size="xs"
              onClick={() => setBulkDeleteConfirmOpen(true)}
              disabled={bulkActionLoading}
            >
              <Trash2 className="size-3" />
              Delete
            </Button>

            {/* Clear Selection */}
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setSelectedIds([])}
              className="text-muted-foreground hover:text-foreground"
              disabled={bulkActionLoading}
            >
              Clear Selection
            </Button>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden max-h-[600px] overflow-y-auto relative scrollbar-thin">
        <Table>
          <TableHeader className="sticky top-0 bg-card z-10 shadow-[inset_0_-1px_0_0_var(--border)]">
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-12 bg-card">
                <div className="flex items-center justify-center h-full">
                  <input
                    type="checkbox"
                    checked={contacts.length > 0 && contacts.every((c) => selectedIds.includes(c.id))}
                    onChange={(e) => {
                      const pageIds = contacts.map((c) => c.id);
                      if (e.target.checked) {
                        setSelectedIds((prev) => {
                          const next = [...prev];
                          pageIds.forEach((id) => {
                            if (!next.includes(id)) next.push(id);
                          });
                          return next;
                        });
                      } else {
                        setSelectedIds((prev) => prev.filter((id) => !pageIds.includes(id)));
                      }
                    }}
                    className="size-4 rounded border-border bg-muted/30 text-brand-teal dark:text-brand-cyan focus:ring-brand-teal/50 dark:focus:ring-brand-cyan/50 cursor-pointer accent-brand-teal dark:accent-brand-cyan"
                  />
                </div>
              </TableHead>
              <TableHead className="text-brand-teal dark:text-brand-cyan bg-card font-semibold">Name</TableHead>
              <TableHead className="text-brand-teal dark:text-brand-cyan bg-card font-semibold">Phone</TableHead>
              <TableHead className="text-brand-teal dark:text-brand-cyan bg-card font-semibold hidden md:table-cell">Email</TableHead>
              <TableHead className="text-brand-teal dark:text-brand-cyan bg-card font-semibold hidden lg:table-cell">Company</TableHead>
              <TableHead className="text-brand-teal dark:text-brand-cyan bg-card font-semibold hidden md:table-cell">Tags</TableHead>
              <TableHead className="text-brand-teal dark:text-brand-cyan bg-card font-semibold hidden lg:table-cell">Created</TableHead>
              <TableHead className="bg-card w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Loader2 className="size-6 animate-spin text-brand-cyan" />
                    <p className="text-sm text-muted-foreground">Loading contacts...</p>
                  </div>
                </TableCell>
              </TableRow>
            ) : contacts.length === 0 ? (
              <TableRow className="border-border">
                <TableCell colSpan={8} className="text-center py-12">
                  <div className="flex flex-col items-center gap-2">
                    <Users className="size-8 text-muted-foreground/60" />
                    <p className="text-sm text-muted-foreground">
                      {search ? 'No contacts match your search.' : 'No contacts yet.'}
                    </p>
                    {!search && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={openAddForm}
                        className="mt-2 border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <Plus className="size-3.5" />
                        Add your first contact
                      </Button>
                    )}
                  </div>
                </TableCell>
              </TableRow>
            ) : (
              contacts.map((contact) => (
                <TableRow
                  key={contact.id}
                  className="border-border hover:bg-accent/50 cursor-pointer transition-colors"
                  onClick={() => openDetail(contact.id)}
                >
                  <TableCell className="w-12" onClick={(e) => e.stopPropagation()}>
                    <div className="flex items-center justify-center">
                      <input
                        type="checkbox"
                        checked={selectedIds.includes(contact.id)}
                        onChange={(e) => {
                          setSelectedIds((prev) =>
                            prev.includes(contact.id)
                              ? prev.filter((id) => id !== contact.id)
                              : [...prev, contact.id]
                          );
                        }}
                        className="size-4 rounded border-border bg-muted/30 text-brand-teal dark:text-brand-cyan focus:ring-brand-teal/50 dark:focus:ring-brand-cyan/50 cursor-pointer accent-brand-teal dark:accent-brand-cyan"
                      />
                    </div>
                  </TableCell>
                  <TableCell className="text-foreground font-semibold">
                    {contact.name || <span className="text-muted-foreground/50 italic">Unnamed</span>}
                  </TableCell>
                  <TableCell className="text-foreground/80 font-mono text-xs">
                    {contact.phone}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden md:table-cell text-sm">
                    {contact.email || <span className="text-muted-foreground/40">-</span>}
                  </TableCell>
                  <TableCell className="text-muted-foreground hidden lg:table-cell text-sm">
                    {contact.company || <span className="text-muted-foreground/40">-</span>}
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {contact.tags && contact.tags.length > 0 ? (
                        contact.tags.slice(0, 3).map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium"
                            style={{
                              backgroundColor: tag.color + '20',
                              color: tag.color,
                            }}
                          >
                            {tag.name}
                          </span>
                        ))
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">-</span>
                      )}
                      {contact.tags && contact.tags.length > 3 && (
                        <span className="text-[10px] text-muted-foreground/60">
                          +{contact.tags.length - 3}
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground/85 text-xs hidden lg:table-cell">
                    {new Date(contact.created_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </TableCell>
                  <TableCell>
                    <DropdownMenu>
                      <DropdownMenuTrigger
                        render={
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-muted-foreground hover:text-foreground"
                            onClick={(e) => e.stopPropagation()}
                          />
                        }
                      >
                        <MoreHorizontal className="size-4" />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        className="bg-card border-border shadow-lg rounded-xl text-card-foreground"
                      >
                        <DropdownMenuItem
                          onClick={(e) => {
                            e.stopPropagation();
                            openEditForm(contact);
                          }}
                          className="focus:bg-accent focus:text-accent-foreground cursor-pointer"
                        >
                          <Pencil className="size-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuSeparator className="bg-border" />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            confirmDelete(contact);
                          }}
                          className="cursor-pointer"
                        >
                          <Trash2 className="size-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            Showing {page * PAGE_SIZE + 1}-{Math.min((page + 1) * PAGE_SIZE, totalCount)} of{' '}
            {totalCount}
          </p>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasPrev}
              onClick={() => handlePageChange(page - 1)}
              className="border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 rounded-lg"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <span className="text-xs text-muted-foreground px-2">
              Page {page + 1} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={!hasNext}
              onClick={() => handlePageChange(page + 1)}
              className="border-border text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30 rounded-lg"
            >
              <ChevronRight className="size-4" />
            </Button>
          </div>
        </div>
      )}

      {/* Contact Form Dialog */}
      <ContactForm
        open={formOpen}
        onOpenChange={setFormOpen}
        contact={editContact}
        contactTags={editContactTags}
        onSaved={() => {
          fetchContacts();
          fetchTags();
          setSelectedIds([]);
        }}
      />

      {/* Contact Detail Sheet */}
      <ContactDetailView
        key={detailContactId ? `${detailContactId}-${drawerSyncKey}` : 'empty'}
        open={detailOpen}
        onOpenChange={setDetailOpen}
        contactId={detailContactId}
        onUpdated={() => {
          fetchContacts();
          setSelectedIds([]);
        }}
      />

      {/* Import Modal */}
      <ImportModal
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={() => {
          fetchContacts();
          setSelectedIds([]);
        }}
      />

      {/* Delete Confirmation */}
      <Dialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-sm rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Contact</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="text-foreground font-semibold">
                {deleteTarget?.name || deleteTarget?.phone}
              </span>
              ? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-card border-t border-border pt-4 mt-2">
            <Button
              variant="outline"
              onClick={() => setDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-accent"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Delete Confirmation */}
      <Dialog open={bulkDeleteConfirmOpen} onOpenChange={setBulkDeleteConfirmOpen}>
        <DialogContent className="bg-card border-border text-foreground sm:max-w-sm rounded-2xl shadow-xl">
          <DialogHeader>
            <DialogTitle className="text-foreground">Delete Multiple Contacts</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Are you sure you want to delete{' '}
              <span className="text-foreground font-semibold">
                {selectedIds.length} selected contact{selectedIds.length !== 1 ? 's' : ''}
              </span>
              ? This action cannot be undone and will delete all associated conversations.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="bg-card border-t border-border pt-4 mt-2">
            <Button
              variant="outline"
              onClick={() => setBulkDeleteConfirmOpen(false)}
              className="border-border text-muted-foreground hover:bg-accent"
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={deleting}
            >
              {deleting && <Loader2 className="size-4 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

