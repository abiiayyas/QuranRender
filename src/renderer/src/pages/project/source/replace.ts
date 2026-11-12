import { confirmDialog } from '../../../store/app'
import { useProject } from '../../../store/project'

/**
 * Before any action that replaces the source: asks when segments would be lost, then saves pending edits so the main
 * job reads the current project. Resolves false when the user cancels.
 */
export async function prepareReplace(): Promise<boolean> {
  const { project, flush } = useProject.getState()
  if (!project) return false
  if (project.sourceAssetId && project.segments.length > 0) {
    const ok = await confirmDialog({
      title: 'Ganti rekaman?',
      body: `Proyek ini sudah memiliki ${project.segments.length} segmen. Waktunya mengikuti rekaman lama, jadi segmen akan dihapus dan perlu disinkronkan ulang.`,
      confirmLabel: 'Ganti rekaman',
      danger: true
    })
    if (!ok) return false
  }
  await flush()
  return true
}
