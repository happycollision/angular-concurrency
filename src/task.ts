// import { Component } from '@angular/compiler/src/core';
import { ChangeDetectorRef } from '@angular/core/src/change_detection';

export async function timeout(time: number = 0) {
  return new Promise(res => setTimeout(res, time));
}

interface Component {
  ngOnDestroy?: () => void;
  ngOnInit?: () => void;
  [s: string]: any;
}

type CreateTaskGeneratorFn = (...args: any[]) => IterableIterator<any> | GeneratorFunction;

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
  'enqueue',
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

  private get __taskInstance() { return 'iamataskinstance'; }

  private resolve!: (val?: any) => void;
  private promise = new Promise((res) => this.resolve = res);

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

  public asPromise() { return this.promise; }

  private async run(context: object, iterator: Generator, lastValue?: any) {
    if (this.shouldRun) {
      let resolved;
      const { value: valueToCheck, done } = iterator.next.call(context, lastValue);
      const value = this.inspectForSpecialYields(valueToCheck);
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

  private inspectForSpecialYields(yieldedValue: any): any {
    if (this.isTaskInstance(yieldedValue)) return yieldedValue.asPromise();
    return yieldedValue;
  }

  private isTaskInstance(possibleInstance: any): possibleInstance is TaskInstance {
    return possibleInstance && possibleInstance.__taskInstance === this.__taskInstance;
  }

  private end() {
    this.isRunning = false;
    this.onCompleteFn(this);
    this.resolve();
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
  private enqueued: Array<[TaskInstance, any[]]> = [];
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
    if (!schedule) return this;
    if (Object.keys(Schedule).indexOf(schedule) === -1) {
      throw new Error(`The schedule name ${schedule} is not a valid schedule.`);
    }
    this._schedule = schedule;
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
      case Schedule.enqueue:
        return this.enqueueNewInstance(...taskArgs);
    }
  }

  public cancelAll() {
    this.emptyQueue();
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

  private enqueueNewInstance(...taskArgs: any[]): TaskInstance {
    this._currentValue = null;
    const newInstance = new TaskInstance(this.generatorFn, this.evaluateReturn.bind(this));

    this.enqueued.push([newInstance, taskArgs]);
    this.instances.push(newInstance);

    this.checkQueue();
    return newInstance;
  }

  private emptyQueue() {
    this.enqueued = [];
  }

  private checkQueue() {
    if (this.isRunning) return;
    const nextEnqueued = this.enqueued.pop();
    if (nextEnqueued) {
      const [instance, args] = nextEnqueued;
      if (instance.isCancelled) {
        this.checkQueue();
        return;
      }
      instance.start(this.parentComponent, ...args);
      this.signalChange();
    }
  }

  private dropNewInstance(): TaskInstance {
    const newInstance = new TaskInstance(this.generatorFn, this.evaluateReturn.bind(this));
    newInstance.cancel();
    this.instances.push(newInstance);
    this.signalChange();
    return newInstance;
  }

  private evaluateReturn(finishedTask: TaskInstance) {
    this.checkQueue();
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
    this.signalChange();
  }

  private signalChange() {
    this._onChange(this);
  }
}

export function _getComponentAndGenerator<C extends Component, G extends CreateTaskGeneratorFn>(currentThis: C | any, generatorOrComponent: G | C, nothingOrGenerator?: G): [C, G] {
  if (nothingOrGenerator) {
    return [
      generatorOrComponent as C,
      nothingOrGenerator,
    ];
  } else {
    return [
      currentThis,
      generatorOrComponent as G,
    ];
  }
}

export function createTask(this: any, component: Component, generator: CreateTaskGeneratorFn): TaskObject;
export function createTask(this: Component, generator: CreateTaskGeneratorFn): TaskObject;
export function createTask(this: Component | any, generatorOrComponent: CreateTaskGeneratorFn | Component, nothingOrGenerator?: CreateTaskGeneratorFn): TaskObject {
  const [ component, generator ] = _getComponentAndGenerator(this, generatorOrComponent, nothingOrGenerator);
  return new TaskObject(component, generator as any as GeneratorFunction);
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
        theTask = createTask(this, this[propKey]);
      }
      this[propKey] = theTask
        .onChange(settings.onChange)
        .setSchedule(settings.schedule);
      oldInit.call(this);
    };
  };
}

export { taskDecoratorFactory as Task };
