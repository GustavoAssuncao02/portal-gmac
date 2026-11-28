import { PayableModal } from './PayableModal.jsx'
import { currentVersion } from './releaseNotes.js'
import { useReleaseNotes } from './useReleaseNotes.js'
import './payables.css'

const formatDate = (date) => date.split('-').reverse().join('/')

export default function ReleaseNotesModal({ onClose }) {
  const releaseNotes = useReleaseNotes()
  return <PayableModal title="Notas de atualização" className="release-notes-modal" onClose={onClose} footer={<button className="admin-tool-button admin-tool-button--primary" type="button" onClick={onClose}>Fechar</button>}>
    <ol className="release-notes">{releaseNotes.map(({ version, date, notes }) => <li key={version}>
      <header><h3>Versão {version}</h3><time dateTime={date}>{formatDate(date)}</time>{version === currentVersion && <span className="release-notes-current">Atual</span>}</header>
      <ul>{notes.map((note, index) => <li key={index}>{note}</li>)}</ul>
    </li>)}</ol>
  </PayableModal>
}
