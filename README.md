# Angular Concurrency

Most everyone using Ember.js today loves [Ember Concurrency](http://ember-concurrency.com). This project allows *similar* functionality in Angular. I am essentially adding functionality as I need it.

I am using this code in production on a couple projects, but it is still a work in progress. See the examples below for the things you get out of the box.

Because of Typescript limitations, there are *two* ways that you can create a task. One is simpler (and uses a decorator), and works fine if you only reference the task inside your HTML template. The other is more verbose, but will type-check properly if you refer to the task inside your class (if you invoke it from another function or something). I believe a future version of TS (after decorators are stage 4 in JS) will allow me to use only the simple version. I am not sure though.

There are no plans (yet) to make this work with Observables. You'll need to only yield POJOs and Promises inside your generator.

## Features

- Zero dependencies
- Automatically cancels all tasks when a component is destroyed
- Schedule tasks' concurrency types using 'concurrent' (default), 'drop', and 'restart'
- Access derived state of your tasks: `isRunning`, `lastCompletedValue`, `lastSuccessfulValue`, `lastErrorValue`, `currentValue`

## Documentation

PRs welcome. :wink:

Love to you all!

## Roadmap

I am not necessarily interested in feature-pairity with EC. Feature requests are welcome. I will, however, eventually be sure that any terminology is comparable, but I have not taken the time to do that just yet.

Things I would like to do:
- Add tests (this will happen before any significant changes to the code)
- Have documentation
- Have live examples inside an actual Anguar app.

## example:

```ts
import { Component } from '@angular/core';
import { createTask, Task, Schedule, TaskObject, timeout } from 'angular-concurrency';

@Component({
  selector: 'app-concurrency-test',
  templateUrl: './concurrency-test.component.html',
  styleUrls: ['./concurrency-test.component.scss'],
})
export class ConcurrencyTestComponent {
  basicTaskText = 'nothing';
  droppingTaskText = 'nothing';
  cancelTaskSeconds = 0;
  restartTaskSeconds = 0;

  basicTask = createTask.call(this, function* (this: ConcurrencyTestComponent) {
    this.basicTaskText = 'waiting.';
    yield timeout(500);
    this.basicTaskText = 'waiting..';
    yield timeout(500);
    this.basicTaskText = 'waiting...';
    yield timeout(500);
    return this.basicTaskText = 'BLAMMO';
  });

  @Task('drop')
  droppingTask = function* (this: ConcurrencyTestComponent) {
    this.droppingTaskText = 'waiting.';
    yield timeout(500);
    this.droppingTaskText = 'waiting..';
    yield timeout(500);
    this.droppingTaskText = 'waiting...';
    yield timeout(500);
    return this.droppingTaskText = 'BLAMMO';
  };

  @Task({
    onChange: function () { console.log('changed', this); },
  })
  cancelTask = function* (this: ConcurrencyTestComponent) {
    let i = 0;
    while (true) {
      this.cancelTaskSeconds = ++i;
      console.log('ran');
      yield timeout(1000);
    }
  };

  @Task('restart') restartTask: TaskObject = function* (this: ConcurrencyTestComponent) {
    let i = 0;
    while (true) {
      this.restartTaskSeconds = ++i;
      console.log('is running', this.restartTask.isRunning);
      yield timeout(1000);
    }
  };
}
```

```html
<h3>unrestricted (concurrent)</h3>
<div>is running: {{basicTask.isRunning}}</div>
<div>count: {{basicTask.count}}</div>
<div>{{basicTaskText}}</div>
<button (click)="basicTask.perform()">Perform</button>

<h3>cancel example</h3>
<div>is running: {{cancelTask.isRunning}}</div>
<div>count: {{cancelTask.count}}</div>
<div>{{cancelTaskSeconds}}</div>
<button (click)="cancelTask.perform()">Perform</button>
<button (click)="cancelTask.cancelAll()">Cancel</button>

<h3>droppable</h3>
<div>is running: {{droppingTask.isRunning}}</div>
<div>count: {{droppingTask.count}}</div>
<div>{{droppingTaskText}}</div>
<button (click)="droppingTask.perform()" [disabled]="droppingTask.isRunning">Perform</button>

<h3>restartable example</h3>
<div>is running: {{restartTask.isRunning}}</div>
<div>count: {{restartTask.count}}</div>
<div>{{restartTaskSeconds}}</div>
<button (click)="restartTask.perform()">Perform</button>
<button (click)="restartTask.cancelAll()">Cancel</button>
```

# Changelog

## 1.0.0
* inital release
