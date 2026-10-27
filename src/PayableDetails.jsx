import { useEffect, useRef, useState } from 'react'
import { Pencil, Check, Undo2, Copy, Power, Trash2, FileDown, Download, Upload, Eye, Ellipsis } from 'lucide-react'
import { PayableModal, FilePreview, previewable } from './PayableModal.jsx'
import { payableRequest, downloadPayableFile, uploadPayableFiles, money, dateLabel } from './payablesApi.js'
import { settlementMethods, treasuryEntry } from '../server/payableRules.js'

const labels = { created: 'Conta criada', edited: 'Conta editada', paid: 'Pagamento baixado', reversed: 'Baixa estornada', deleted: 'Conta excluída', deactivated: 'Conta desativada', reactivated: 'Conta reativada', attachment_added: 'Anexo adicionado', attachment_removed: 'Anexo removido', status_changed: 'Status alterado', classification_created: 'Classificação criada', classification_edited: 'Classificação alterada', classification_deleted: 'Classificação excluída', account_group_created: 'Grupo de contas criado', account_group_edited: 'Grupo de contas alterado', account_group_deleted: 'Grupo de contas excluído', dre_settings_edited: 'Classificações automáticas alteradas', supplier_created: 'Fornecedor criado', supplier_edited: 'Fornecedor editado', supplier_deleted: 'Fornecedor excluído' }
const fieldLabels = { supplierName: 'Fornecedor', classificationName: 'Classificação', description: 'Descrição', documentNumber: 'Documento', issueDate: 'Emissão', dueDate: 'Vencimento', valueCents: 'Valor', installmentCount: 'Parcelas', kind: 'Tipo', recurrence: 'Recorrência', orderCode: 'OS vinculada', name: 'Nome', document: 'CPF/CNPJ', email: 'E-mail', phone: 'Telefone', inactive: 'Desativado' }
export function HistoryRows({ rows }) {
  return <ol className="payable-history">{rows.map((row) => {
    const diff = row.changes || (row.details?.before ? row.details : null)
    const changes = diff ? Object.keys(fieldLabels).filter((key) => diff.before?.[key] !== diff.after?.[key]).map((key) => `${fieldLabels[key]}: ${key === 'valueCents' ? money(diff.before?.[key]) : diff.before?.[key] ?? '—'} → ${key === 'valueCents' ? money(diff.after?.[key]) : diff.after?.[key] ?? '—'}`) : []
    return <li key={row.id}><div><strong>{labels[row.type] || row.type}</strong><span>{row.accountId}</span></div><small>{new Date(row.at).toLocaleString('pt-BR', { timeZone: 'America/Bahia' })} · {row.userName}</small>{row.reason && <p>{row.reason}</p>}{changes.map((text) => <p key={text}>{text}</p>)}{row.details?.name && <p>{row.details.name}</p>}{row.details?.text && <p>{row.details.text}</p>}{row.type === 'paid' && <p>{money(row.details.finalCents)} · {dateLabel(row.details.date)} · {settlementMethods[row.details.method] || row.details.method}{row.details.interestCents ? ` · Juros: ${money(row.details.interestCents)}` : ''}{row.details.discountCents ? ` · Desconto: ${money(row.details.discountCents)}` : ''}{row.details.bulk ? ' · Baixa em massa' : ''}{row.details.note ? ` · ${row.details.note}` : ''}</p>}{row.type === 'status_changed' && <p>{row.details.before} → {row.details.after}</p>}{row.type.startsWith('classification_') || row.type.startsWith('supplier_') ? <p>{row.details?.after?.name || row.details?.name}</p> : null}</li>
  })}{!rows.length && <li>Nenhuma movimentação.</li>}</ol>
}

function MoreActions({ actions, disabled, onPick }) {
  const [open, setOpen] = useState(false), box = useRef(null)
  useEffect(() => {
    if (!open) return undefined
    box.current.querySelector('[role=menuitem]')?.focus()
    const close = (event) => { if (!box.current?.contains(event.target)) setOpen(false) }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  if (!actions.length) return null
  return <div className="payable-more" ref={box} onKeyDown={(event) => { if (event.key === 'Escape' && open) { event.stopPropagation(); event.preventDefault(); setOpen(false); box.current.querySelector('button').focus() } }}>
    <button type="button" className="admin-tool-button" aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={() => setOpen(!open)}><Ellipsis size={15} />Mais ações</button>
    {open && <div className="payable-more-menu" role="menu">{actions.map(([key, label, Icon]) => <button type="button" role="menuitem" key={key} className={key === 'delete' ? 'payable-danger' : ''} onClick={() => { setOpen(false); onPick(key) }}><Icon size={15} />{label}</button>)}</div>}
  </div>
}

export default function PayableDetails({ id, onClose, onAction, refreshVersion }) {
  const [data, setData] = useState(null), [error, setError] = useState(''), [busy, setBusy] = useState(false), [version, setVersion] = useState(0), [preview, setPreview] = useState(null)
  useEffect(() => { let active = true; payableRequest(`/payables/${id}`).then((result) => { if (active) { setData(result); setError('') } }).catch((caught) => { if (active) setError(caught.message) }); return () => { active = false } }, [id, version, refreshVersion])
  const row = data?.item
  async function run(fn) { setBusy(true); setError(''); try { await fn(); setVersion((v) => v + 1) } catch (caught) { setError(caught.message) } finally { setBusy(false) } }
  // An entry posted in Tesouraria stays paid while it is corrected.
  const paid = Boolean(row?.payment), direct = treasuryEntry(row), locked = paid && !direct || row?.inactive
  // Only actions that are possible now; the main ones stay visible and the rest go to "Mais ações".
  const primary = !row ? [] : row.inactive ? [['reactivate', 'Reativar', Power]] : direct ? [['edit', 'Editar', Pencil]] : paid ? [['reverse', 'Estornar baixa', Undo2]] : [['pay', 'Dar baixa', Check], ['edit', 'Editar', Pencil]]
  const secondary = !row ? [] : [['duplicate', 'Duplicar', Copy], ...(direct ? [['reverse', 'Estornar baixa', Undo2]] : []), ...(paid && !row.inactive ? [['deactivate', 'Desativar', Power]] : []), ['pdf', 'Gerar PDF individual', FileDown], ...(data.canDelete ? [['delete', 'Excluir', Trash2]] : [])]
  return <PayableModal title={id} wide busy={busy} onClose={onClose} footer={row && <div className="payable-detail-actions"><MoreActions actions={secondary} disabled={busy} onPick={(key) => onAction(key, data)} />{primary.map(([key, label, Icon]) => <button type="button" className={`admin-tool-button ${key === 'pay' ? 'admin-tool-button--primary' : ''}`} disabled={busy} key={key} onClick={() => onAction(key, data)}><Icon size={15} />{label}</button>)}</div>}>
    {error && <p className="admin-tool-error" role="alert">{error}<button type="button" className="admin-tool-button" onClick={() => setVersion((v) => v + 1)}>Tentar novamente</button></p>}{!row ? !error && <p>Carregando conta...</p> : <>
      <section><h3>Dados principais</h3><dl className="payable-facts">{[['Fornecedor', row.supplierName], ['Descrição', `${row.description || '—'}${row.inactive ? ' (D)' : ''}`], row.classificationSplit?.length ? ['Classificações', row.classificationSplit.map((part) => `${part.classificationName} ${money(part.valueCents)}`).join(' · ')] : ['Classificação', row.classificationName], ['Documento / boleto / NF', row.documentNumber || '—'], ['Emissão', dateLabel(row.issueDate)], ['Valor', money(row.valueCents)], ['Vencimento', dateLabel(row.dueDate)], ['Status', `${row.status === 'paid' ? 'Pago' : row.status === 'overdue' ? 'Vencido' : 'Pendente'}${row.inactive ? ' (D)' : ''}`], ['Tipo', row.kind === 'installment' ? `Parcela ${row.installmentNumber} de ${row.installmentCount}` : row.kind === 'recurring' ? `Recorrente · ${row.recurrence === 'monthly' ? 'Mensal' : 'Anual'}${row.seriesId ? ` · ocorrência ${row.seriesIndex} de ${row.seriesCount}` : ''}` : 'Normal'], ['OS vinculada (custo)', row.orderCode || 'Nenhuma'], ...(row.treasury ? [['Origem', 'Tesouraria · lançada já paga']] : []), ...(row.groupId ? [['Valor total original', money(row.originalTotalCents)]] : []), ...(row.previousId ? [['Criada a partir de', row.previousId]] : [])].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {paid && <><h3>Pagamento</h3><dl className="payable-facts">{[['Data', dateLabel(row.payment.date)], ['Forma', settlementMethods[row.payment.method]], ...(row.payment.bankName ? [['Banco', row.payment.bankName]] : []), ['Juros', money(row.payment.interestCents)], ['Desconto', money(row.payment.discountCents)], ['Valor final', money(row.payment.finalCents)], ['Observação', row.payment.note || '—']].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl></>}
      {data.siblings.length > 0 && <><h3>Parcelas da compra</h3><div className="payable-siblings">{data.siblings.map((part) => <button type="button" key={part.id} onClick={() => onAction('open', { item: part })}><strong>{part.id} · {part.installmentNumber}/{part.installmentCount}</strong><span>{money(part.valueCents)} · {dateLabel(part.dueDate)} · {{ pending: 'Pendente', overdue: 'Vencido', paid: 'Pago' }[part.status]}</span></button>)}</div></>}
      </section><section><h3>Anexos</h3><ul className="payable-attachments">{[...row.attachments, ...(row.payment?.receipts || [])].map((file) => <li key={file.id}><span><strong>{file.name}</strong><small>{file.contentType} · {(file.size / 1024).toFixed(1)} KB</small></span>{previewable(file) && <button type="button" className="payable-icon" aria-label={`Visualizar ${file.name}`} title="Visualizar" onClick={() => setPreview(file)}><Eye size={17} /></button>}<button type="button" className="payable-icon" aria-label={`Baixar ${file.name}`} title="Baixar arquivo" onClick={() => run(() => downloadPayableFile(id, file))}><Download size={17} /></button><button type="button" className="payable-icon" aria-label={`Excluir anexo ${file.name}`} title="Excluir anexo" disabled={locked || busy} onClick={() => run(() => payableRequest(`/payables/${id}/files/${file.id}`, 'DELETE'))}><Trash2 size={17} /></button></li>)}</ul>{!row.attachments.length && !row.payment?.receipts?.length && <p className="payable-muted">Nenhum anexo.</p>}<label className={`admin-tool-button payable-upload-button ${locked ? 'is-disabled' : ''}`}><Upload size={16} />Adicionar anexos<input type="file" multiple hidden disabled={locked || busy} onChange={(event) => { const files = [...event.target.files]; event.target.value = ''; run(() => uploadPayableFiles(files, id)) }} /></label></section>
      <section><h3>Histórico</h3><HistoryRows rows={data.history} /></section>
    </>}
    {preview && <FilePreview url={`/api/payables/${id}/files/${preview.id}`} file={preview} onClose={() => setPreview(null)} />}
  </PayableModal>
}
