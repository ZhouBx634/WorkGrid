export default function SelectionCheckbox({ selected, label, onToggle }: { selected: boolean; label: string; onToggle: () => void }) {
  return <input className="batch-checkbox" type="checkbox" aria-label={label} title={label} checked={selected} onChange={onToggle} onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()} onTouchStart={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()} />
}
