import React from 'react';
import { useAppStore } from '../store';
import { Button } from './ui/button';

export const BatchQueue: React.FC = () => {
  const { batchQueue, removeBatchJob } = useAppStore();
  
  return (
    <div className="p-4 bg-card rounded-md border border-border">
      <div className="flex justify-between items-center mb-4">
        <h3 className="font-semibold text-lg">Batch Processing Workspace</h3>
      </div>
      
      {batchQueue.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-4">No batch jobs queued. You can add jobs from the Editor or import multiple audio files.</p>
      ) : (
        <div className="space-y-3">
          {batchQueue.map(job => (
            <div key={job.id} className="p-3 border border-border rounded flex justify-between items-center bg-background">
              <div>
                <p className="font-medium text-sm">Job: {job.id}</p>
                <p className="text-xs text-muted-foreground">Status: {job.status}</p>
                <div className="w-full bg-muted h-1 mt-2 rounded-full overflow-hidden">
                  <div className="bg-primary h-full transition-all" style={{ width: `${job.progress}%` }} />
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" onClick={() => removeBatchJob(job.id)}>
                  Remove
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
