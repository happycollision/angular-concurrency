import { Component } from '@angular/compiler/src/core';
import { ChangeDetectorRef } from '@angular/core/src/change_detection';

export async function timeout(time: number = 0) {
  return new Promise(res => setTimeout(res, time));
}

// See https://basarat.gitbooks.io/typescript/content/docs/types/literal-types.html
function strEnum<T extends string>(o: Array<T>): { [K in T]: K } {
  return o.reduce((res, key) => {
    res[key] = key;
    return res;
  }, Object.create(null));
}

export const Schedule = strEnum([
  'concurrent',
  'drop',
  'restart',
]);

export type Schedule = keyof typeof Schedule;

export interface TaskOptions {
  schedule?: Schedule;
  onChange?: (task: TaskObject) => void;
}

export interface ITaskInstance {
  isRunning: boolean;
  completed: null | { success: boolean, error: boolean, value: any };
  isCancelled: boolean;
  hasStarted: boolean;
  cancel(): void;
}

let uid = 0;
function getNewId(): number {
  return ++uid;
}

export class TaskInstance implements ITaskInstance {
  id = getNewId();
  hasStarted = false;
  isRunning = false;
  isCancelled = false;
  completed: null | { success: boolean, error: boolean, value: any } = null;

  private get shouldRun(): boolean {
    return (!this.isCancelled) && this.isRunning;
  }

  constructor(
    private generatorFn: GeneratorFunction,
    private onCompleteFn: (completedTaskInstance: TaskInstance) => any,
  ) { }

  public cancel() {
    this.endWithCancel();
  }

  public start(context: object, ...taskArgs: any[]): this {
    if (this.hasStarted) return this;
    this.hasStarted = true;
    this.isRunning = true;
    const iterator = this.generatorFn.call(context, ...taskArgs);
    this.run(context, iterator);
    return this;
  }

  private async run(context: object, iterator: Generator, lastValue?: any) {
    if (this.shouldRun) {
      let resolved;
      const { value, done } = iterator.next.call(context, lastValue);
      try {
        resolved = await value;
      } catch (e) {
        return this.endWithErrorValue(e);
      }
      if (done) {
        if (value instanceof Error) {
          this.endWithErrorValue(value);
        } else {
          this.endWithSuccessValue(resolved);
        }
      } else {
        this.run(context, iterator, resolved);
      }
    }
  }

  private end() {
    this.isRunning = false;
    this.onCompleteFn(this);
  }

  private endWithSuccessValue(value: any) {
    this.completed = { success: true, error: false, value };
    this.end();
  }

  private endWithCancel() {
    this.isCancelled = true;
    this.end();
  }

  private endWithErrorValue(error: Error) {
    this.completed = { success: false, error: true, value: error };
    this.end();
  }
}

export class TaskObject {
  private instances: TaskInstance[] = [];
  private parentDestroyed = false;
  private _lastCompletedValue: any = null;
  private _lastSuccessfulValue: any = null;
  private _lastErrorValue: Error | null = null;
  private _currentValue: any;
  private _schedule: Schedule = Schedule.concurrent;
  private _onChange: (task: TaskObject) => void = () => { };

  public get lastCompletedValue(): TaskObject['_lastCompletedValue'] { return this._lastCompletedValue; }
  public get lastSuccessfulValue(): TaskObject['_lastSuccessfulValue'] { return this._lastSuccessfulValue; }
  public get lastErrorValue(): TaskObject['_lastErrorValue'] { return this._lastErrorValue; }
  public get currentValue(): TaskObject['_currentValue'] { return this._currentValue; }
  public get schedule(): Schedule { return this._schedule; }

  get isRunning(): boolean {
    return this.instances.length > 0 && this.instances.some(instance => instance.isRunning);
  }

  get count(): number {
    return this.instances.filter(instance => instance.isRunning).length;
  }

  constructor(
    private parentComponent: Component,
    private generatorFn: GeneratorFunction,
    private changeDetector?: ChangeDetectorRef,
  ) {
    this.hookUpParentEvents();
  }

  public setSchedule(schedule?: Schedule): this {
    if (schedule) { this._schedule = schedule; }
    return this;
  }

  public perform(...taskArgs: any[]): ITaskInstance {
    if (this.parentDestroyed) return this.dropNewInstance();

    switch (this.schedule) {
      case Schedule.concurrent:
        return this.startNewInstance(...taskArgs);
      case Schedule.drop:
        if (this.isRunning) {
          return this.dropNewInstance();
        } else {
          return this.startNewInstance(...taskArgs);
        }
      case Schedule.restart:
        this.cancelAll();
        return this.startNewInstance(...taskArgs);
    }
  }

  public cancelAll() {
    this.instances.forEach(inst => inst.cancel());
  }

  public onChange(fn?: (task: TaskObject) => void): this {
    if (fn) { this._onChange = fn; }
    return this;
  }

  private hookUpParentEvents() {
    const component: any = this.parentComponent;
    const parentDestroy: () => void = component['ngOnDestroy'] || (() => { });

    component['ngOnDestroy'] = () => {
      this._onChange = () => { };
      this.cancelAll();
      this.parentDestroyed = true;
      parentDestroy.call(component);
    };
  }

  private startNewInstance(...taskArgs: any[]): TaskInstance {
    this._currentValue = null;
    const newInstance = new TaskInstance(this.generatorFn, this.evaluateReturn.bind(this)).start(this.parentComponent, ...taskArgs);
    this.instances.push(newInstance);
    this.signalChange();
    return newInstance;
  }

  private dropNewInstance(): TaskInstance {
    const newInstance = new TaskInstance(this.generatorFn, this.evaluateReturn.bind(this));
    newInstance.cancel();
    this.instances.push(newInstance);
    this.signalChange();
    return newInstance;
  }

  private evaluateReturn(finishedTask: TaskInstance) {
    this.signalChange();
    if (finishedTask.completed) {
      if (finishedTask.completed.success) {
        this._lastSuccessfulValue = finishedTask.completed.value;
        this._lastCompletedValue = finishedTask.completed.value;
      }
      if (finishedTask.completed.error) {
        this._lastErrorValue = finishedTask.completed.value;
        this._lastCompletedValue = finishedTask.completed.value;
      }
      this._currentValue = finishedTask.completed.value;
    }
  }

  private signalChange() {
    this._onChange(this);
  }
}

export function createTask(this: Component, generator: GeneratorFunction): TaskObject {
  return new TaskObject(this, generator);
}


function taskDecoratorFactory(options: TaskOptions | Schedule = {}) {
  const settings: TaskOptions = typeof options === 'string' ? { schedule: options } : options;
  return function taskDecorator(target: any, propKey: string) {
    if (!target['ngOnDestroy']) { target['ngOnDestroy'] = () => { }; }
    const oldInit = target['ngOnInit'] || (() => { });

    target['ngOnInit'] = function () {
      // `this` ends up being the instance
      let theTask: TaskObject;
      if (this[propKey] instanceof TaskObject) {
        theTask = this[propKey];
      } else {
        theTask = createTask.call(this, this[propKey]);
      }
      this[propKey] = theTask
        .onChange(settings.onChange)
        .setSchedule(settings.schedule);
      oldInit.call(this);
    };
  };
}

export { taskDecoratorFactory as Task };
